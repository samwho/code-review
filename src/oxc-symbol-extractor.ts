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

export interface OxcFileSymbols {
  filename: string;
  symbols: OxcSymbol[];
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
   * Extract symbols from changed files only (with caching)
   */
  async extractFromChangedFiles(files: FileDiff[], baseBranch: string): Promise<OxcFileSymbols[]> {
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
          batch.map(file => this.processFileWithCaching(file, baseBranch))
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
  private async processFileWithCaching(file: FileDiff, baseBranch: string): Promise<OxcFileSymbols | null> {
    try {
      const content = this.fileHashCache.get(file.filename) || await this.getFileContent(file.filename, baseBranch);
      const cacheKey = this.generateCacheKey(file.filename, content);
      
      const symbols = this.extractSymbolsFromContent(content, file.filename);
      
      if (symbols.length > 0) {
        const fileSymbols: OxcFileSymbols = {
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
              this.extractFromDeclaration(node.declaration, symbols, true);
            }
            // Handle re-exports (export { name } from 'module')
            if (node.specifiers) {
              node.specifiers.forEach(spec => {
                if (spec.exported && spec.exported.name) {
                  symbols.push({
                    name: spec.exported.name,
                    type: 'export',
                    line: spec.exported.loc?.start.line || 0,
                    isExported: true
                  });
                }
              });
            }
            break;

          case 'ClassDeclaration':
          case 'FunctionDeclaration':
          case 'TSInterfaceDeclaration':
            this.extractFromDeclaration(node, symbols, false);
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
  private extractFromDeclaration(node: any, symbols: OxcSymbol[], isExported: boolean): void {
    switch (node.type) {
      case 'ClassDeclaration':
        if (node.id && node.id.name) {
          const className = node.id.name;
          symbols.push({
            name: className,
            type: 'class',
            line: node.loc?.start.line || 0,
            isExported
          });

          // Extract class methods
          if (node.body && node.body.body) {
            node.body.body.forEach((member: any) => {
              if (member.type === 'MethodDefinition' && member.key && member.key.name) {
                symbols.push({
                  name: member.key.name,
                  type: 'function',
                  line: member.loc?.start.line || 0,
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
            line: node.loc?.start.line || 0,
            isExported
          });
        }
        break;

      case 'TSInterfaceDeclaration':
        if (node.id && node.id.name) {
          symbols.push({
            name: node.id.name,
            type: 'export',
            line: node.loc?.start.line || 0,
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
                line: decl.loc?.start.line || 0,
                isExported
              });
            } else if (isExported) {
              // Export any other variable declarations
              symbols.push({
                name,
                type: 'export',
                line: decl.loc?.start.line || 0,
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