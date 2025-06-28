/**
 * Unified TypeScript/JavaScript analyzer using ts-morph
 * Replaces all manual parsing with proper AST analysis
 */

import { Project, Node, SyntaxKind, ImportDeclaration as TSImportDeclaration, ExportDeclaration as TSExportDeclaration, FunctionDeclaration, MethodDeclaration, ArrowFunction, ClassDeclaration, InterfaceDeclaration, VariableDeclaration, TypeAliasDeclaration, EnumDeclaration } from 'ts-morph';

export interface ParsedImport {
  source: string;
  imports: ImportSpecifier[];
  line: number;
  isTypeOnly: boolean;
}

export interface ImportSpecifier {
  name: string;
  alias?: string;
  isDefault?: boolean;
  isNamespace?: boolean;
  isTypeOnly?: boolean;
}

export interface ParsedExport {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'const' | 'let' | 'var' | 'enum' | 'namespace';
  isDefault: boolean;
  line: number;
  isTypeOnly: boolean;
}

export interface ParsedFunction {
  name: string;
  startLine: number;
  endLine: number;
  isExported: boolean;
  isAsync: boolean;
  parameters: string[];
  isMethod: boolean;
  className?: string;
}

export interface ParsedSymbol {
  name: string;
  kind: 'function' | 'method' | 'variable' | 'parameter' | 'class' | 'interface' | 'type' | 'enum' | 'namespace' | 'property' | 'unknown';
  isFunction: boolean;
  isExported: boolean;
  line: number;
  column: number;
  definition?: {
    file: string;
    line: number;
    column: number;
  };
}

export interface FileAnalysis {
  filename: string;
  imports: ParsedImport[];
  exports: ParsedExport[];
  functions: ParsedFunction[];
  symbols: ParsedSymbol[];
  dependencies: string[];
  errors: string[];
}

export class TSMorphAnalyzer {
  private project: Project;

  constructor() {
    this.project = new Project({
      compilerOptions: {
        target: 'ES2020',
        module: 'ESNext',
        moduleResolution: 'bundler',
        allowJs: true,
        allowImportingTsExtensions: true,
        declaration: false,
        skipLibCheck: true,
        strict: false, // Relax for better compatibility
      },
      useInMemoryFileSystem: true,
    });
  }

  async analyzeFiles(fileContents: Map<string, string>): Promise<Map<string, FileAnalysis>> {
    const results = new Map<string, FileAnalysis>();

    try {
      // Add all files to the project
      for (const [filename, content] of fileContents) {
        this.project.createSourceFile(filename, content, { overwrite: true });
      }

      // Analyze each file
      for (const [filename] of fileContents) {
        const sourceFile = this.project.getSourceFile(filename);
        if (sourceFile) {
          const analysis = this.analyzeSourceFile(sourceFile, filename);
          results.set(filename, analysis);
        }
      }
    } catch (error) {
      console.warn('TSMorph analysis failed:', error);
    }

    return results;
  }

  private analyzeSourceFile(sourceFile: any, filename: string): FileAnalysis {
    const imports: ParsedImport[] = [];
    const exports: ParsedExport[] = [];
    const functions: ParsedFunction[] = [];
    const symbols: ParsedSymbol[] = [];
    const dependencies: string[] = [];
    const errors: string[] = [];

    try {
      // Parse imports
      this.parseImports(sourceFile, imports, dependencies);
      
      // Parse exports
      this.parseExports(sourceFile, exports);
      
      // Parse functions
      this.parseFunctions(sourceFile, functions);
      
      // Parse all symbols
      this.parseSymbols(sourceFile, symbols, filename);

    } catch (error) {
      errors.push(`Analysis error: ${error}`);
    }

    return {
      filename,
      imports,
      exports,
      functions,
      symbols,
      dependencies,
      errors
    };
  }

  private parseImports(sourceFile: any, imports: ParsedImport[], dependencies: string[]): void {
    sourceFile.getImportDeclarations().forEach((importDecl: TSImportDeclaration) => {
      const moduleSpecifier = importDecl.getModuleSpecifierValue();
      const lineNumber = sourceFile.getLineAndColumnAtPos(importDecl.getStart()).line;
      const isTypeOnly = importDecl.isTypeOnly();
      
      const importSpecifiers: ImportSpecifier[] = [];
      
      // Default import
      const defaultImport = importDecl.getDefaultImport();
      if (defaultImport) {
        importSpecifiers.push({
          name: defaultImport.getText(),
          isDefault: true,
          isTypeOnly: false
        });
      }
      
      // Namespace import
      const namespaceImport = importDecl.getNamespaceImport();
      if (namespaceImport) {
        importSpecifiers.push({
          name: namespaceImport.getName(),
          isNamespace: true,
          isTypeOnly: false
        });
      }
      
      // Named imports
      const namedImports = importDecl.getNamedImports();
      namedImports.forEach(namedImport => {
        const name = namedImport.getName();
        const alias = namedImport.getAliasNode()?.getText();
        importSpecifiers.push({
          name,
          alias,
          isTypeOnly: namedImport.isTypeOnly()
        });
      });
      
      imports.push({
        source: moduleSpecifier,
        imports: importSpecifiers,
        line: lineNumber,
        isTypeOnly
      });
      
      // Add to dependencies if it's a relative import
      if (this.isRelativeImport(moduleSpecifier)) {
        if (!dependencies.includes(moduleSpecifier)) {
          dependencies.push(moduleSpecifier);
        }
      }
    });
  }

  private parseExports(sourceFile: any, exports: ParsedExport[]): void {
    // Export declarations
    sourceFile.getExportDeclarations().forEach((exportDecl: TSExportDeclaration) => {
      const lineNumber = sourceFile.getLineAndColumnAtPos(exportDecl.getStart()).line;
      
      exportDecl.getNamedExports().forEach(namedExport => {
        exports.push({
          name: namedExport.getName(),
          kind: 'const', // Default to const, will be refined below
          isDefault: false,
          line: lineNumber,
          isTypeOnly: namedExport.isTypeOnly()
        });
      });
    });

    // Export assignments (export default ...)
    sourceFile.getExportAssignments().forEach((exportAssign: any) => {
      const lineNumber = sourceFile.getLineAndColumnAtPos(exportAssign.getStart()).line;
      exports.push({
        name: 'default',
        kind: 'const',
        isDefault: true,
        line: lineNumber,
        isTypeOnly: false
      });
    });

    // Exported declarations (export function, export class, etc.)
    sourceFile.getStatements().forEach((statement: Node) => {
      if (statement.hasModifier(SyntaxKind.ExportKeyword)) {
        const lineNumber = sourceFile.getLineAndColumnAtPos(statement.getStart()).line;
        const isDefault = statement.hasModifier(SyntaxKind.DefaultKeyword);
        
        let name = 'unknown';
        let kind: ParsedExport['kind'] = 'const';
        
        if (statement.getKind() === SyntaxKind.FunctionDeclaration) {
          const funcDecl = statement as FunctionDeclaration;
          name = funcDecl.getName() || 'default';
          kind = 'function';
        } else if (statement.getKind() === SyntaxKind.ClassDeclaration) {
          const classDecl = statement as ClassDeclaration;
          name = classDecl.getName() || 'default';
          kind = 'class';
        } else if (statement.getKind() === SyntaxKind.InterfaceDeclaration) {
          const intDecl = statement as InterfaceDeclaration;
          name = intDecl.getName();
          kind = 'interface';
        } else if (statement.getKind() === SyntaxKind.TypeAliasDeclaration) {
          const typeDecl = statement as TypeAliasDeclaration;
          name = typeDecl.getName();
          kind = 'type';
        } else if (statement.getKind() === SyntaxKind.EnumDeclaration) {
          const enumDecl = statement as EnumDeclaration;
          name = enumDecl.getName();
          kind = 'enum';
        } else if (statement.getKind() === SyntaxKind.VariableStatement) {
          const varStatement = statement as any;
          const declarations = varStatement.getDeclarationList().getDeclarations();
          declarations.forEach((decl: VariableDeclaration) => {
            exports.push({
              name: decl.getName(),
              kind: varStatement.getDeclarationList().getFlags() === SyntaxKind.ConstKeyword ? 'const' : 
                    varStatement.getDeclarationList().getFlags() === SyntaxKind.LetKeyword ? 'let' : 'var',
              isDefault,
              line: lineNumber,
              isTypeOnly: false
            });
          });
          return;
        }
        
        exports.push({
          name,
          kind,
          isDefault,
          line: lineNumber,
          isTypeOnly: false
        });
      }
    });
  }

  private parseFunctions(sourceFile: any, functions: ParsedFunction[]): void {
    // Function declarations
    sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration).forEach((funcDecl: FunctionDeclaration) => {
      const name = funcDecl.getName() || 'anonymous';
      const startPos = funcDecl.getStart();
      const endPos = funcDecl.getEnd();
      const startLine = sourceFile.getLineAndColumnAtPos(startPos).line;
      const endLine = sourceFile.getLineAndColumnAtPos(endPos).line;
      const isExported = funcDecl.hasModifier(SyntaxKind.ExportKeyword);
      const isAsync = funcDecl.hasModifier(SyntaxKind.AsyncKeyword);
      const parameters = funcDecl.getParameters().map(param => param.getName());
      
      functions.push({
        name,
        startLine,
        endLine,
        isExported,
        isAsync,
        parameters,
        isMethod: false
      });
    });

    // Method declarations
    sourceFile.getDescendantsOfKind(SyntaxKind.MethodDeclaration).forEach((methodDecl: MethodDeclaration) => {
      const name = methodDecl.getName();
      const startPos = methodDecl.getStart();
      const endPos = methodDecl.getEnd();
      const startLine = sourceFile.getLineAndColumnAtPos(startPos).line;
      const endLine = sourceFile.getLineAndColumnAtPos(endPos).line;
      const isAsync = methodDecl.hasModifier(SyntaxKind.AsyncKeyword);
      const parameters = methodDecl.getParameters().map(param => param.getName());
      
      // Find parent class
      const classDecl = methodDecl.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
      const className = classDecl?.getName();
      const isExported = classDecl?.hasModifier(SyntaxKind.ExportKeyword) || false;
      
      functions.push({
        name,
        startLine,
        endLine,
        isExported,
        isAsync,
        parameters,
        isMethod: true,
        className
      });
    });

    // Arrow functions (assigned to variables)
    sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction).forEach((arrowFunc: ArrowFunction) => {
      // Try to find the variable name this arrow function is assigned to
      const varDecl = arrowFunc.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
      if (varDecl) {
        const name = varDecl.getName();
        const startPos = arrowFunc.getStart();
        const endPos = arrowFunc.getEnd();
        const startLine = sourceFile.getLineAndColumnAtPos(startPos).line;
        const endLine = sourceFile.getLineAndColumnAtPos(endPos).line;
        const isAsync = arrowFunc.hasModifier(SyntaxKind.AsyncKeyword);
        const parameters = arrowFunc.getParameters().map(param => param.getName());
        
        // Check if the variable statement is exported
        const varStatement = varDecl.getFirstAncestorByKind(SyntaxKind.VariableStatement);
        const isExported = varStatement?.hasModifier(SyntaxKind.ExportKeyword) || false;
        
        functions.push({
          name,
          startLine,
          endLine,
          isExported,
          isAsync,
          parameters,
          isMethod: false
        });
      }
    });
  }

  private parseSymbols(sourceFile: any, symbols: ParsedSymbol[], filename: string): void {
    sourceFile.forEachDescendant((node: Node) => {
      if (node.getKind() === SyntaxKind.Identifier) {
        // Skip identifiers in comments and string literals
        if (this.isInCommentOrString(node)) {
          return;
        }
        
        const symbol = this.analyzeIdentifier(node, filename, sourceFile);
        if (symbol) {
          symbols.push(symbol);
        }
      }
    });

    // Remove duplicates based on name + line + column
    const uniqueSymbols = symbols.filter((symbol, index, array) => 
      array.findIndex(s => 
        s.name === symbol.name && 
        s.line === symbol.line && 
        s.column === symbol.column
      ) === index
    );
    
    symbols.length = 0;
    symbols.push(...uniqueSymbols);
  }

  private isInCommentOrString(node: Node): boolean {
    try {
      // Check if we're inside a string literal
      let current = node.getParent();
      while (current) {
        const kind = current.getKind();
        if (kind === SyntaxKind.StringLiteral || 
            kind === SyntaxKind.TemplateExpression ||
            kind === SyntaxKind.NoSubstitutionTemplateLiteral) {
          return true;
        }
        current = current.getParent();
      }
      
      // Check if we're inside a comment by looking at the source text
      const sourceFile = node.getSourceFile();
      const pos = node.getStart();
      const fullText = sourceFile.getFullText();
      
      // Find the line containing this position
      const lineStart = fullText.lastIndexOf('\n', pos) + 1;
      const lineEnd = fullText.indexOf('\n', pos);
      const line = fullText.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
      
      // Check if the position is after a // comment
      const commentIndex = line.indexOf('//');
      if (commentIndex !== -1) {
        const columnInLine = pos - lineStart;
        if (columnInLine >= commentIndex) {
          return true;
        }
      }
      
      return false;
    } catch (error) {
      return false;
    }
  }

  private analyzeIdentifier(node: Node, filename: string, sourceFile: any): ParsedSymbol | null {
    try {
      const name = node.getText();
      
      // Skip very short or common identifiers
      if (name.length < 2 || this.isCommonKeyword(name)) {
        return null;
      }

      const pos = node.getStart();
      const lineAndColumn = sourceFile.getLineAndColumnAtPos(pos);

      // Get semantic information
      const symbolKind = this.getSymbolKind(node);
      const isFunction = this.isSymbolFunction(node);
      const isExported = this.isSymbolExported(node);

      return {
        name,
        kind: symbolKind,
        isFunction,
        isExported,
        line: lineAndColumn.line,
        column: lineAndColumn.column,
        definition: this.getDefinitionLocation(node)
      };
    } catch (error) {
      return null;
    }
  }

  private getSymbolKind(node: Node): ParsedSymbol['kind'] {
    try {
      const parent = node.getParent();
      
      // Function call: identifier followed by (
      if (parent?.getKind() === SyntaxKind.CallExpression) {
        const callExpr = parent;
        if (callExpr.getFirstChild() === node) {
          return 'function';
        }
      }

      // Method call: property access with call
      if (parent?.getKind() === SyntaxKind.PropertyAccessExpression) {
        const propAccess = parent;
        if (propAccess.getLastChild() === node) {
          const grandparent = propAccess.getParent();
          if (grandparent?.getKind() === SyntaxKind.CallExpression) {
            return 'method';
          }
          return 'property';
        }
      }

      // Function declaration
      if (parent?.getKind() === SyntaxKind.FunctionDeclaration) {
        return 'function';
      }

      // Method declaration
      if (parent?.getKind() === SyntaxKind.MethodDeclaration) {
        return 'method';
      }

      // Variable declaration
      if (parent?.getKind() === SyntaxKind.VariableDeclaration) {
        return 'variable';
      }

      // Parameter
      if (parent?.getKind() === SyntaxKind.Parameter) {
        return 'parameter';
      }

      // Class declaration
      if (parent?.getKind() === SyntaxKind.ClassDeclaration) {
        return 'class';
      }

      // Interface declaration
      if (parent?.getKind() === SyntaxKind.InterfaceDeclaration) {
        return 'interface';
      }

      // Type alias
      if (parent?.getKind() === SyntaxKind.TypeAliasDeclaration) {
        return 'type';
      }

      // Enum declaration
      if (parent?.getKind() === SyntaxKind.EnumDeclaration) {
        return 'enum';
      }

      return 'unknown';
    } catch (error) {
      return 'unknown';
    }
  }

  private isSymbolFunction(node: Node): boolean {
    const kind = this.getSymbolKind(node);
    return kind === 'function' || kind === 'method';
  }

  private isSymbolExported(node: Node): boolean {
    try {
      // Check if node is part of an export declaration
      let current = node.getParent();
      while (current) {
        if (current.getKind() === SyntaxKind.ExportDeclaration ||
            current.getKind() === SyntaxKind.ExportAssignment) {
          return true;
        }
        if (current.hasModifier && current.hasModifier(SyntaxKind.ExportKeyword)) {
          return true;
        }
        current = current.getParent();
      }

      return false;
    } catch (error) {
      return false;
    }
  }

  private getDefinitionLocation(node: Node): ParsedSymbol['definition'] {
    try {
      // For now, return the current location as definition
      // In a full implementation, we'd use the type checker to find the actual definition
      const sourceFile = node.getSourceFile();
      const pos = node.getStart();
      const lineAndColumn = sourceFile.getLineAndColumnAtPos(pos);

      return {
        file: sourceFile.getFilePath(),
        line: lineAndColumn.line,
        column: lineAndColumn.column
      };
    } catch (error) {
      return undefined;
    }
  }

  private isCommonKeyword(name: string): boolean {
    const keywords = new Set([
      'const', 'let', 'var', 'function', 'class', 'interface', 'type', 'enum',
      'import', 'export', 'from', 'as', 'default', 'async', 'await',
      'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case',
      'try', 'catch', 'finally', 'throw', 'new', 'this', 'super',
      'true', 'false', 'null', 'undefined', 'void', 'typeof', 'instanceof',
      'in', 'of', 'extends', 'implements', 'public', 'private', 'protected',
      'static', 'readonly', 'abstract'
    ]);
    return keywords.has(name);
  }

  private isRelativeImport(modulePath: string): boolean {
    return modulePath.startsWith('./') || modulePath.startsWith('../');
  }

  dispose() {
    // Clean up the project
    this.project.getSourceFiles().forEach(sf => sf.delete());
  }
}