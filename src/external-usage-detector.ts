/**
 * Service for finding external usages of symbols modified in a pull request
 * Scans the entire codebase to find files affected by PR changes
 */

import { SimpleSymbolExtractor, type FileSymbols, type SimpleSymbol } from './simple-symbol-extractor';
import { Project } from 'ts-morph';
import { spawn } from 'bun';
import { join } from 'path';

export interface ExternalUsage {
  symbol: string;
  symbolType: 'class' | 'function' | 'export';
  definedIn: string;
  usedIn: string;
  line: number;
  context: string;
  usageType: 'import' | 'function_call' | 'property_access' | 'type_reference' | 'instantiation' | 'other';
}

export interface ExternalUsageResult {
  affectedFiles: {
    filename: string;
    usages: ExternalUsage[];
    impactLevel: 'high' | 'medium' | 'low';
  }[];
  totalFiles: number;
  scanDuration: number;
}

export class ExternalUsageDetector {
  private project: Project;
  private repoPath: string;
  private symbolExtractor: SimpleSymbolExtractor;

  constructor(repoPath?: string) {
    this.repoPath = repoPath || process.cwd() + '/test-repo';
    this.symbolExtractor = new SimpleSymbolExtractor(this.repoPath);
    this.project = new Project({
      useInMemoryFileSystem: false,
      compilerOptions: {
        allowJs: true,
        allowSyntheticDefaultImports: true,
        esModuleInterop: true,
        target: 99, // Latest
      },
    });
  }

  /**
   * Find all files in the codebase that use symbols modified in the PR
   */
  async findExternalUsages(changedFileSymbols: FileSymbols[]): Promise<ExternalUsageResult> {
    const startTime = Date.now();
    
    // Extract all symbols that were modified in the PR
    const modifiedSymbols = new Map<string, { symbol: SimpleSymbol; definedIn: string }>();
    for (const fileSymbol of changedFileSymbols) {
      for (const symbol of fileSymbol.symbols) {
        modifiedSymbols.set(symbol.name, {
          symbol,
          definedIn: fileSymbol.filename
        });
      }
    }

    // Get all TypeScript/JavaScript files in the codebase (excluding the changed files)
    const changedFiles = new Set(changedFileSymbols.map(fs => fs.filename));
    const allFiles = await this.getAllSourceFiles();
    const filesToScan = allFiles.filter(file => !changedFiles.has(file));

    console.log(`Scanning ${filesToScan.length} files for external usages of ${modifiedSymbols.size} symbols...`);

    const affectedFiles: ExternalUsageResult['affectedFiles'] = [];

    // Scan each file for usages of modified symbols
    for (const filePath of filesToScan) {
      const usages = await this.scanFileForUsages(filePath, modifiedSymbols);
      
      if (usages.length > 0) {
        affectedFiles.push({
          filename: filePath,
          usages,
          impactLevel: this.calculateImpactLevel(usages)
        });
      }
    }

    // Sort by impact level and number of usages
    affectedFiles.sort((a, b) => {
      const impactOrder = { 'high': 3, 'medium': 2, 'low': 1 };
      if (impactOrder[a.impactLevel] !== impactOrder[b.impactLevel]) {
        return impactOrder[b.impactLevel] - impactOrder[a.impactLevel];
      }
      return b.usages.length - a.usages.length;
    });

    const scanDuration = Date.now() - startTime;

    return {
      affectedFiles,
      totalFiles: filesToScan.length,
      scanDuration
    };
  }

  /**
   * Get all TypeScript/JavaScript source files in the repository
   */
  private async getAllSourceFiles(): Promise<string[]> {
    try {
      // Use git to find all tracked files, then filter for source files
      const proc = spawn(['git', 'ls-files'], {
        cwd: this.repoPath,
        stdout: 'pipe',
        stderr: 'pipe'
      });

      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        throw new Error('Failed to get file list from git');
      }

      const output = await new Response(proc.stdout).text();
      const allFiles = output.trim().split('\n').filter(Boolean);

      // Filter for TypeScript/JavaScript files
      const sourceFiles = allFiles.filter(file => {
        const ext = file.split('.').pop()?.toLowerCase();
        return ext && ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(ext);
      });

      return sourceFiles;
    } catch (error) {
      console.warn('Failed to get git file list, falling back to filesystem scan:', error);
      // Fallback: could implement filesystem scanning here
      return [];
    }
  }

  /**
   * Scan a single file for usages of modified symbols
   */
  private async scanFileForUsages(
    filePath: string, 
    modifiedSymbols: Map<string, { symbol: SimpleSymbol; definedIn: string }>
  ): Promise<ExternalUsage[]> {
    try {
      const fullPath = join(this.repoPath, filePath);
      
      // Add source file to ts-morph project
      const sourceFile = this.project.addSourceFileAtPath(fullPath);
      const usages: ExternalUsage[] = [];

      // Look for imports first
      sourceFile.getImportDeclarations().forEach(importDecl => {
        const moduleSpecifier = importDecl.getModuleSpecifierValue();
        
        importDecl.getNamedImports().forEach(namedImport => {
          const importName = namedImport.getName();
          const symbolInfo = modifiedSymbols.get(importName);
          
          if (symbolInfo && this.isImportFromModifiedFile(moduleSpecifier, symbolInfo.definedIn, filePath)) {
            usages.push({
              symbol: importName,
              symbolType: symbolInfo.symbol.type,
              definedIn: symbolInfo.definedIn,
              usedIn: filePath,
              line: importDecl.getStartLineNumber(),
              context: importDecl.getText(),
              usageType: 'import'
            });
          }
        });

        // Check default imports
        const defaultImport = importDecl.getDefaultImport();
        if (defaultImport) {
          const importName = defaultImport.getText();
          const symbolInfo = modifiedSymbols.get(importName);
          
          if (symbolInfo && this.isImportFromModifiedFile(moduleSpecifier, symbolInfo.definedIn, filePath)) {
            usages.push({
              symbol: importName,
              symbolType: symbolInfo.symbol.type,
              definedIn: symbolInfo.definedIn,
              usedIn: filePath,
              line: importDecl.getStartLineNumber(),
              context: importDecl.getText(),
              usageType: 'import'
            });
          }
        }
      });

      // Look for direct symbol references in the code
      const allIdentifiers = sourceFile.getDescendantsOfKind(256); // SyntaxKind.Identifier
      
      for (const identifier of allIdentifiers) {
        const symbolName = identifier.getText();
        const symbolInfo = modifiedSymbols.get(symbolName);
        
        if (symbolInfo) {
          // Skip if this is part of an import we already found
          if (identifier.getFirstAncestorByKind(270)) { // SyntaxKind.ImportDeclaration
            continue;
          }

          const usageType = this.determineUsageType(identifier);
          const line = identifier.getStartLineNumber();
          const context = this.getUsageContext(identifier);

          usages.push({
            symbol: symbolName,
            symbolType: symbolInfo.symbol.type,
            definedIn: symbolInfo.definedIn,
            usedIn: filePath,
            line,
            context,
            usageType
          });
        }
      }

      // Clean up
      this.project.removeSourceFile(sourceFile);

      return usages;
    } catch (error) {
      console.warn(`Failed to scan ${filePath}:`, error);
      return [];
    }
  }

  /**
   * Check if an import is from a modified file
   */
  private isImportFromModifiedFile(moduleSpecifier: string, definedIn: string, currentFile: string): boolean {
    // Handle relative imports
    if (moduleSpecifier.startsWith('./') || moduleSpecifier.startsWith('../')) {
      // Resolve relative path and compare with definedIn
      const currentDir = currentFile.split('/').slice(0, -1).join('/');
      let resolvedPath = moduleSpecifier;
      
      // Simple path resolution (could be enhanced)
      if (moduleSpecifier.startsWith('./')) {
        resolvedPath = join(currentDir, moduleSpecifier.slice(2));
      } else if (moduleSpecifier.startsWith('../')) {
        const parentDir = currentDir.split('/').slice(0, -1).join('/');
        resolvedPath = join(parentDir, moduleSpecifier.slice(3));
      }
      
      // Add common extensions if not present
      if (!resolvedPath.includes('.')) {
        for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
          if (definedIn === resolvedPath + ext) {
            return true;
          }
        }
      }
      
      return definedIn.includes(resolvedPath) || resolvedPath.includes(definedIn.replace(/\.[^.]+$/, ''));
    }
    
    // For absolute imports, check if module name matches file path
    return definedIn.includes(moduleSpecifier) || moduleSpecifier.includes(definedIn.replace(/\.[^.]+$/, ''));
  }

  /**
   * Determine the type of symbol usage
   */
  private determineUsageType(identifier: any): ExternalUsage['usageType'] {
    const parent = identifier.getParent();
    const grandParent = parent?.getParent();
    
    // Function call: identifier()
    if (parent?.getKind() === 212) { // SyntaxKind.CallExpression
      return 'function_call';
    }
    
    // Property access: obj.identifier or identifier.prop
    if (parent?.getKind() === 211) { // SyntaxKind.PropertyAccessExpression
      return 'property_access';
    }
    
    // New expression: new identifier()
    if (parent?.getKind() === 213) { // SyntaxKind.NewExpression
      return 'instantiation';
    }
    
    // Type reference: identifier<T> or variable: identifier
    if (grandParent?.getKind() === 182) { // SyntaxKind.TypeReference
      return 'type_reference';
    }
    
    return 'other';
  }

  /**
   * Get contextual information about where the symbol is used
   */
  private getUsageContext(identifier: any): string {
    const line = identifier.getStartLineNumber();
    const sourceFile = identifier.getSourceFile();
    const fullText = sourceFile.getFullText();
    const lines = fullText.split('\n');
    
    if (line > 0 && line <= lines.length) {
      return lines[line - 1].trim();
    }
    
    return identifier.getParent()?.getText()?.slice(0, 100) || '';
  }

  /**
   * Calculate the impact level based on usage patterns
   */
  private calculateImpactLevel(usages: ExternalUsage[]): 'high' | 'medium' | 'low' {
    const highImpactTypes = ['import', 'instantiation', 'type_reference'];
    const mediumImpactTypes = ['function_call'];
    
    const highCount = usages.filter(u => highImpactTypes.includes(u.usageType)).length;
    const mediumCount = usages.filter(u => mediumImpactTypes.includes(u.usageType)).length;
    
    if (highCount > 0 || usages.length > 10) {
      return 'high';
    } else if (mediumCount > 0 || usages.length > 3) {
      return 'medium';
    } else {
      return 'low';
    }
  }
}