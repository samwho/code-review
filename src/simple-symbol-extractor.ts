/**
 * Simple symbol extractor for changed files only
 * Extracts classes, functions, and exports from TypeScript/JavaScript files
 */

import { Project } from 'ts-morph';
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
   * Extract symbols from changed files only
   */
  async extractFromChangedFiles(files: FileDiff[], baseBranch: string): Promise<FileSymbols[]> {
    const result: FileSymbols[] = [];

    for (const file of files) {
      if (this.isSupportedFile(file.filename)) {
        try {
          const content = await this.getFileContent(file.filename, baseBranch);
          const symbols = this.extractSymbolsFromContent(content, file.filename);
          
          if (symbols.length > 0) {
            result.push({
              filename: file.filename,
              symbols
            });
          }
        } catch (error) {
          console.warn(`Failed to extract symbols from ${file.filename}:`, error);
        }
      }
    }

    return result;
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
            isExported: interfaceDecl.isExported()
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