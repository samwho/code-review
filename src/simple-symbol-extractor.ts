/**
 * Simple symbol extractor for changed files only
 * Extracts classes, functions, and exports from TypeScript/JavaScript files
 */

import { Project } from 'ts-morph';
import { createHash } from 'crypto';
import type { FileDiff } from './types/git';

export type SimpleSymbol = 
  | {
      type: 'class';
      name: string;
      line: number;
      isExported: boolean;
    }
  | {
      type: 'function';
      name: string;
      line: number;
      isExported: boolean;
      className?: string; // Present for class methods, undefined for standalone functions
    }
  | {
      type: 'export';
      name: string;
      line: number;
      isExported: true; // Exports are always exported
    };

export interface FileSymbols {
  filename: string;
  symbols: SimpleSymbol[];
}

export class SimpleSymbolExtractor {
  private project: Project;
  private repoPath: string;
  private cache = new Map<string, FileSymbols>();
  private fileHashCache = new Map<string, string>();

  constructor(repoPath?: string) {
    this.repoPath = repoPath || process.cwd() + '/test-repo';
    this.project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: {
        allowJs: true,
        allowSyntheticDefaultImports: true,
        esModuleInterop: true,
        target: 99, // Latest
      },
    });
  }

  /**
   * Generate cache key for file content
   */
  private generateCacheKey(filename: string, content: string): string {
    const contentHash = createHash('md5').update(content).digest('hex');
    return `${filename}:${contentHash}`;
  }

  /**
   * Extract symbols from changed files only (with caching)
   */
  async extractFromChangedFiles(files: FileDiff[], baseBranch: string): Promise<FileSymbols[]> {
    const result: FileSymbols[] = [];
    const uncachedFiles: FileDiff[] = [];

    // Check cache first
    for (const file of files) {
      if (this.isSupportedFile(file.filename)) {
        try {
          const content = await this.getFileContent(file.filename, baseBranch);
          const cacheKey = this.generateCacheKey(file.filename, content);
          
          const cached = this.cache.get(cacheKey);
          if (cached) {
            result.push(cached);
          } else {
            uncachedFiles.push(file);
            // Store content for later processing
            this.fileHashCache.set(file.filename, content);
          }
        } catch (error) {
          console.warn(`Failed to get content for ${file.filename}:`, error);
        }
      }
    }

    // Process uncached files in parallel batches
    if (uncachedFiles.length > 0) {
      const BATCH_SIZE = 5; // Process 5 files at a time to avoid memory issues
      const batches = this.createBatches(uncachedFiles, BATCH_SIZE);
      
      for (const batch of batches) {
        const batchResults = await Promise.all(
          batch.map(file => this.processFileWithCaching(file, baseBranch))
        );
        
        result.push(...batchResults.filter(r => r !== null) as FileSymbols[]);
      }
    }

    return result;
  }

  /**
   * Create batches of items for parallel processing
   */
  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Process a single file and cache the result
   */
  private async processFileWithCaching(file: FileDiff, baseBranch: string): Promise<FileSymbols | null> {
    try {
      const content = this.fileHashCache.get(file.filename) || await this.getFileContent(file.filename, baseBranch);
      const cacheKey = this.generateCacheKey(file.filename, content);
      
      const symbols = this.extractSymbolsFromContent(content, file.filename);
      
      if (symbols.length > 0) {
        const fileSymbols: FileSymbols = {
          filename: file.filename,
          symbols
        };
        
        // Cache the result
        this.cache.set(cacheKey, fileSymbols);
        
        return fileSymbols;
      }
      
      return null;
    } catch (error) {
      console.warn(`Failed to extract symbols from ${file.filename}:`, error);
      return null;
    } finally {
      // Clean up temporary content cache
      this.fileHashCache.delete(file.filename);
    }
  }

  /**
   * Extract symbols from file content using ts-morph
   */
  private extractSymbolsFromContent(content: string, filename: string): SimpleSymbol[] {
    const symbols: SimpleSymbol[] = [];
    
    try {
      const sourceFile = this.project.createSourceFile(filename, content, { overwrite: true });

      // Extract class declarations and their methods
      sourceFile.getClasses().forEach(classDecl => {
        const className = classDecl.getName();
        if (className) {
          symbols.push({
            name: className,
            type: 'class',
            line: classDecl.getStartLineNumber(),
            isExported: classDecl.isExported()
          });

          // Extract class methods
          classDecl.getMethods().forEach(methodDecl => {
            const methodName = methodDecl.getName();
            if (methodName) {
              symbols.push({
                name: methodName,
                type: 'function',
                line: methodDecl.getStartLineNumber(),
                isExported: classDecl.isExported(), // Methods inherit class export status
                className: className
              });
            }
          });

          // Extract getters and setters
          classDecl.getGetAccessors().forEach(getter => {
            const getterName = getter.getName();
            if (getterName) {
              symbols.push({
                name: getterName,
                type: 'function',
                line: getter.getStartLineNumber(),
                isExported: classDecl.isExported(),
                className: className
              });
            }
          });

          classDecl.getSetAccessors().forEach(setter => {
            const setterName = setter.getName();
            if (setterName) {
              symbols.push({
                name: setterName,
                type: 'function',
                line: setter.getStartLineNumber(),
                isExported: classDecl.isExported(),
                className: className
              });
            }
          });
        }
      });

      // Extract interface declarations
      sourceFile.getInterfaces().forEach(interfaceDecl => {
        const name = interfaceDecl.getName();
        if (name) {
          symbols.push({
            name,
            type: 'export',
            line: interfaceDecl.getStartLineNumber(),
            isExported: true // Interfaces we extract are always exported
          });
        }
      });

      // Extract function declarations
      sourceFile.getFunctions().forEach(funcDecl => {
        const name = funcDecl.getName();
        if (name) {
          symbols.push({
            name,
            type: 'function',
            line: funcDecl.getStartLineNumber(),
            isExported: funcDecl.isExported()
          });
        }
      });

      // Extract variable declarations (including const exports)
      sourceFile.getVariableDeclarations().forEach(varDecl => {
        const name = varDecl.getName();
        const initializer = varDecl.getInitializer();
        
        if (name) {
          const isExported = varDecl.getVariableStatement()?.hasExportKeyword() || false;
          
          if (initializer) {
            // Check if it's an arrow function or function expression
            if (initializer.getKindName() === 'ArrowFunction' || 
                initializer.getKindName() === 'FunctionExpression') {
              symbols.push({
                name,
                type: 'function',
                line: varDecl.getStartLineNumber(),
                isExported
              });
            } else if (isExported) {
              // Export any other const/let/var declarations
              symbols.push({
                name,
                type: 'export',
                line: varDecl.getStartLineNumber(),
                isExported: true
              });
            }
          } else if (isExported) {
            // Export declarations without initializers
            symbols.push({
              name,
              type: 'export',
              line: varDecl.getStartLineNumber(),
              isExported: true
            });
          }
        }
      });

      // Extract exports
      sourceFile.getExportDeclarations().forEach(exportDecl => {
        exportDecl.getNamedExports().forEach(namedExport => {
          // Get the alias name if it exists, otherwise use the original name
          const aliasNode = namedExport.getAliasNode();
          const name = aliasNode ? aliasNode.getText() : namedExport.getName();
          symbols.push({
            name,
            type: 'export',
            line: exportDecl.getStartLineNumber(),
            isExported: true
          });
        });
      });

      // Clean up
      this.project.removeSourceFile(sourceFile);

    } catch (error) {
      console.warn(`Failed to parse ${filename}:`, error);
    }

    return symbols;
  }

  /**
   * Check if file is supported for symbol extraction
   */
  private isSupportedFile(filename: string): boolean {
    return /\.(ts|tsx|js|jsx)$/.test(filename);
  }

  /**
   * Get file content using git show
   */
  private async getFileContent(filename: string, branch: string): Promise<string> {
    const proc = Bun.spawn(['git', 'show', `${branch}:${filename}`], {
      cwd: this.repoPath,
      stdout: 'pipe',
      stderr: 'pipe'
    });

    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      throw new Error(`Failed to get content for ${filename}`);
    }

    return output;
  }
}