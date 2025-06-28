import { Project, Node, SyntaxKind, Symbol as TSSymbol, TypeChecker } from 'ts-morph';

export interface SemanticSymbol {
  name: string;
  kind: 'function' | 'method' | 'variable' | 'parameter' | 'class' | 'interface' | 'type' | 'enum' | 'namespace' | 'unknown';
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

export interface SemanticAnalysis {
  filename: string;
  symbols: SemanticSymbol[];
  errors: string[];
}

export class SemanticAnalyzer {
  private project: Project;
  private typeChecker: TypeChecker | null = null;

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
        strict: false, // Relax for better compatibility with diverse codebases
      },
      useInMemoryFileSystem: true,
    });
  }

  async analyzeFiles(fileContents: Map<string, string>): Promise<Map<string, SemanticAnalysis>> {
    const results = new Map<string, SemanticAnalysis>();

    try {
      // Add all files to the project
      for (const [filename, content] of fileContents) {
        this.project.createSourceFile(filename, content, { overwrite: true });
      }

      // Get type checker after all files are added
      this.typeChecker = this.project.getTypeChecker();

      // Analyze each file
      for (const [filename] of fileContents) {
        const sourceFile = this.project.getSourceFile(filename);
        if (sourceFile) {
          const analysis = this.analyzeSourceFile(sourceFile, filename);
          results.set(filename, analysis);
        }
      }
    } catch (error) {
      console.warn('Semantic analysis failed:', error);
    }

    return results;
  }

  private analyzeSourceFile(sourceFile: any, filename: string): SemanticAnalysis {
    const symbols: SemanticSymbol[] = [];
    const errors: string[] = [];

    try {
      // Visit all identifier nodes in the file
      sourceFile.forEachDescendant((node: Node) => {
        if (node.getKind() === SyntaxKind.Identifier) {
          const symbol = this.analyzeIdentifier(node, filename);
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

      return {
        filename,
        symbols: uniqueSymbols,
        errors
      };
    } catch (error) {
      errors.push(`Analysis error: ${error}`);
      return { filename, symbols: [], errors };
    }
  }

  private analyzeIdentifier(node: Node, filename: string): SemanticSymbol | null {
    try {
      const name = node.getText();
      
      // Skip very short or common identifiers
      if (name.length < 2 || this.isCommonKeyword(name)) {
        return null;
      }

      const pos = node.getStart();
      const sourceFile = node.getSourceFile();
      const lineAndColumn = sourceFile.getLineAndColumnAtPos(pos);

      // Get semantic information from TypeScript
      const tsSymbol = this.getSymbolAtPosition(node);
      const symbolKind = this.getSymbolKind(node, tsSymbol);
      const isFunction = this.isSymbolFunction(node, tsSymbol);
      const isExported = this.isSymbolExported(node, tsSymbol);

      return {
        name,
        kind: symbolKind,
        isFunction,
        isExported,
        line: lineAndColumn.line,
        column: lineAndColumn.column,
        definition: this.getDefinitionLocation(tsSymbol)
      };
    } catch (error) {
      return null;
    }
  }

  private getSymbolAtPosition(node: Node): TSSymbol | undefined {
    try {
      if (!this.typeChecker) return undefined;
      
      // Get the symbol from the type checker
      const symbol = (node as any).getSymbol?.();
      return symbol;
    } catch (error) {
      return undefined;
    }
  }

  private getSymbolKind(node: Node, symbol: TSSymbol | undefined): SemanticSymbol['kind'] {
    try {
      // Check the node's parent context first
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

      // Use symbol information if available
      if (symbol) {
        const flags = symbol.getFlags?.();
        if (flags) {
          if (flags & 4 /* Function */) return 'function';
          if (flags & 8192 /* Method */) return 'method';
          if (flags & 2 /* Variable */) return 'variable';
          if (flags & 32 /* Class */) return 'class';
          if (flags & 64 /* Interface */) return 'interface';
          if (flags & 524288 /* TypeAlias */) return 'type';
        }
      }

      return 'unknown';
    } catch (error) {
      return 'unknown';
    }
  }

  private isSymbolFunction(node: Node, symbol: TSSymbol | undefined): boolean {
    const kind = this.getSymbolKind(node, symbol);
    return kind === 'function' || kind === 'method';
  }

  private isSymbolExported(node: Node, symbol: TSSymbol | undefined): boolean {
    try {
      // Check if node is part of an export declaration
      let current = node.getParent();
      while (current) {
        if (current.getKind() === SyntaxKind.ExportDeclaration ||
            current.getKind() === SyntaxKind.ExportAssignment) {
          return true;
        }
        if (current.getModifiers?.().some((mod: any) => 
            mod.getKind() === SyntaxKind.ExportKeyword)) {
          return true;
        }
        current = current.getParent();
      }

      return false;
    } catch (error) {
      return false;
    }
  }

  private getDefinitionLocation(symbol: TSSymbol | undefined): SemanticSymbol['definition'] {
    try {
      if (!symbol) return undefined;

      const declarations = symbol.getDeclarations?.();
      if (!declarations || declarations.length === 0) return undefined;

      const firstDecl = declarations[0];
      const sourceFile = firstDecl.getSourceFile();
      const pos = firstDecl.getStart();
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
      'true', 'false', 'null', 'undefined', 'void'
    ]);
    return keywords.has(name);
  }

  dispose() {
    // Clean up the project
    this.project.getSourceFiles().forEach(sf => sf.delete());
  }
}