/**
 * High-performance symbol extractor using OXC parser
 * Much faster alternative to ts-morph for symbol extraction
 */

import { parseSync } from 'oxc-parser';
import { createHash } from 'crypto';
import { simpleGit } from 'simple-git';
import type { SimpleGit } from 'simple-git';
import type { FileDiff } from './types/git';
import { APP_CONFIG } from './config';

export type OxcSymbol = 
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

export interface OxcImport {
  module: string;
  isRelative: boolean;
  importedSymbols: string[];
  line: number;
}

export interface OxcExport {
  module: string | null;
  exportedSymbols: string[];
  isReExport: boolean;
  line: number;
}

export interface OxcFileSymbols {
  filename: string;
  symbols: OxcSymbol[];
  imports?: OxcImport[];
  exports?: OxcExport[];
}

export class OxcSymbolExtractor {
  private repoPath: string;
  private git: SimpleGit;
  private cache = new Map<string, OxcFileSymbols>();
  private fileHashCache = new Map<string, string>();

  constructor(repoPath?: string) {
    this.repoPath = repoPath || APP_CONFIG.DEFAULT_REPO_PATH;
    this.git = simpleGit(this.repoPath);
  }

  /**
   * Generate cache key for file content
   */
  private generateCacheKey(filename: string, content: string): string {
    const contentHash = createHash('md5').update(content).digest('hex');
    return `${filename}:${contentHash}`;
  }

  /**
   * Extract symbols and dependencies from changed files (with caching)
   */
  async extractFromChangedFiles(files: FileDiff[], baseBranch: string, includeDependencies = false): Promise<OxcFileSymbols[]> {
    const result: OxcFileSymbols[] = [];
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
      const BATCH_SIZE = 10; // OXC is faster, so we can handle larger batches
      const batches = this.createBatches(uncachedFiles, BATCH_SIZE);
      
      for (const batch of batches) {
        const batchResults = await Promise.all(
          batch.map(file => this.processFileWithCaching(file, baseBranch, includeDependencies))
        );
        
        result.push(...batchResults.filter(r => r !== null) as OxcFileSymbols[]);
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
  private async processFileWithCaching(file: FileDiff, baseBranch: string, includeDependencies = false): Promise<OxcFileSymbols | null> {
    try {
      const content = this.fileHashCache.get(file.filename) || await this.getFileContent(file.filename, baseBranch);
      const cacheKey = this.generateCacheKey(file.filename, content);
      
      const symbols = this.extractSymbolsFromContent(content, file.filename);
      const dependencies = includeDependencies ? this.extractDependenciesFromContent(content, file.filename) : null;
      
      if (symbols.length > 0 || (dependencies && (dependencies.imports.length > 0 || dependencies.exports.length > 0))) {
        const fileSymbols: OxcFileSymbols = {
          filename: file.filename,
          symbols,
          ...(dependencies && {
            imports: dependencies.imports,
            exports: dependencies.exports
          })
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
   * Convert byte position to line number
   */
  private getLineNumber(content: string, bytePosition: number): number {
    if (bytePosition === undefined || bytePosition < 0) return 1;
    
    let line = 1;
    for (let i = 0; i < bytePosition && i < content.length; i++) {
      if (content[i] === '\n') {
        line++;
      }
    }
    return line;
  }

  /**
   * Extract imports and exports from file content using OXC parser
   */
  extractDependenciesFromContent(content: string, filename: string): { imports: OxcImport[], exports: OxcExport[] } {
    const imports: OxcImport[] = [];
    const exports: OxcExport[] = [];
    
    try {
      const result = parseSync(filename, content, {
        sourceType: 'module'
      });

      result.program.body.forEach(node => {
        switch (node.type) {
          case 'ImportDeclaration':
            if (node.source && node.source.value) {
              const modulePath = node.source.value;
              const importedSymbols: string[] = [];
              
              // Extract imported symbols
              if (node.specifiers) {
                node.specifiers.forEach(spec => {
                  if (spec.type === 'ImportSpecifier' && spec.imported && spec.imported.name) {
                    importedSymbols.push(spec.imported.name);
                  } else if (spec.type === 'ImportDefaultSpecifier' && spec.local && spec.local.name) {
                    importedSymbols.push('default');
                  } else if (spec.type === 'ImportNamespaceSpecifier' && spec.local && spec.local.name) {
                    importedSymbols.push('*');
                  }
                });
              }
              
              imports.push({
                module: modulePath,
                isRelative: modulePath.startsWith('./') || modulePath.startsWith('../'),
                importedSymbols,
                line: this.getLineNumber(content, node.start)
              });
            }
            break;

          case 'ExportNamedDeclaration':
            const exportedSymbols: string[] = [];
            let isReExport = false;
            let module: string | null = null;
            
            if (node.source && node.source.value) {
              // Re-export from another module
              isReExport = true;
              module = node.source.value;
            }
            
            if (node.specifiers) {
              node.specifiers.forEach(spec => {
                if (spec.exported && spec.exported.name) {
                  exportedSymbols.push(spec.exported.name);
                }
              });
            }
            
            if (node.declaration) {
              // Extract names from declaration
              this.extractExportNamesFromDeclaration(node.declaration, exportedSymbols);
            }
            
            if (exportedSymbols.length > 0) {
              exports.push({
                module,
                exportedSymbols,
                isReExport,
                line: this.getLineNumber(content, node.start)
              });
            }
            break;

          case 'ExportDefaultDeclaration':
            exports.push({
              module: null,
              exportedSymbols: ['default'],
              isReExport: false,
              line: this.getLineNumber(content, node.start)
            });
            break;

          case 'ExportAllDeclaration':
            if (node.source && node.source.value) {
              exports.push({
                module: node.source.value,
                exportedSymbols: ['*'],
                isReExport: true,
                line: this.getLineNumber(content, node.start)
              });
            }
            break;
        }
      });

    } catch (error) {
      console.warn(`Failed to parse dependencies in ${filename} with OXC:`, error);
    }

    return { imports, exports };
  }

  /**
   * Extract export names from a declaration node
   */
  private extractExportNamesFromDeclaration(node: any, exportedSymbols: string[]): void {
    switch (node.type) {
      case 'ClassDeclaration':
      case 'FunctionDeclaration':
      case 'TSInterfaceDeclaration':
        if (node.id && node.id.name) {
          exportedSymbols.push(node.id.name);
        }
        break;
      case 'VariableDeclaration':
        node.declarations.forEach((decl: any) => {
          if (decl.id && decl.id.name) {
            exportedSymbols.push(decl.id.name);
          }
        });
        break;
    }
  }

  /**
   * Extract symbols from file content using OXC parser
   */
  private extractSymbolsFromContent(content: string, filename: string): OxcSymbol[] {
    const symbols: OxcSymbol[] = [];
    
    try {
      const result = parseSync(filename, content, {
        sourceType: 'module'
      });

      result.program.body.forEach(node => {
        switch (node.type) {
          case 'ExportNamedDeclaration':
            if (node.declaration) {
              this.extractFromDeclaration(node.declaration, symbols, true, content);
            }
            // Handle re-exports (export { name } from 'module')
            if (node.specifiers) {
              node.specifiers.forEach(spec => {
                if (spec.exported && spec.exported.name) {
                  symbols.push({
                    name: spec.exported.name,
                    type: 'export',
                    line: this.getLineNumber(content, spec.exported.start),
                    isExported: true
                  });
                }
              });
            }
            break;

          case 'ClassDeclaration':
          case 'FunctionDeclaration':
          case 'TSInterfaceDeclaration':
            this.extractFromDeclaration(node, symbols, false, content);
            break;
        }
      });

    } catch (error) {
      console.warn(`Failed to parse ${filename} with OXC:`, error);
    }

    return symbols;
  }

  /**
   * Extract symbols from a declaration node
   */
  private extractFromDeclaration(node: any, symbols: OxcSymbol[], isExported: boolean, content: string): void {
    switch (node.type) {
      case 'ClassDeclaration':
        if (node.id && node.id.name) {
          const className = node.id.name;
          symbols.push({
            name: className,
            type: 'class',
            line: this.getLineNumber(content, node.start),
            isExported
          });

          // Extract class methods (skip constructors)
          if (node.body && node.body.body) {
            node.body.body.forEach((member: any) => {
              if (member.type === 'MethodDefinition' && member.key && member.key.name && member.key.name !== 'constructor') {
                symbols.push({
                  name: member.key.name,
                  type: 'function',
                  line: this.getLineNumber(content, member.start),
                  isExported, // Methods inherit class export status
                  className: className
                });
              }
            });
          }
        }
        break;

      case 'FunctionDeclaration':
        if (node.id && node.id.name) {
          symbols.push({
            name: node.id.name,
            type: 'function',
            line: this.getLineNumber(content, node.start),
            isExported
          });
        }
        break;

      case 'TSInterfaceDeclaration':
        if (node.id && node.id.name) {
          symbols.push({
            name: node.id.name,
            type: 'export',
            line: this.getLineNumber(content, node.start),
            isExported
          });
        }
        break;

      case 'VariableDeclaration':
        node.declarations.forEach((decl: any) => {
          if (decl.id && decl.id.name) {
            const name = decl.id.name;
            
            // Check if it's a function expression or arrow function
            if (decl.init && (decl.init.type === 'ArrowFunctionExpression' || decl.init.type === 'FunctionExpression')) {
              symbols.push({
                name,
                type: 'function',
                line: this.getLineNumber(content, decl.start),
                isExported
              });
            } else if (isExported) {
              // Export any other variable declarations
              symbols.push({
                name,
                type: 'export',
                line: this.getLineNumber(content, decl.start),
                isExported: true
              });
            }
          }
        });
        break;
    }
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
    return await this.git.show([`${branch}:${filename}`]);
  }
}