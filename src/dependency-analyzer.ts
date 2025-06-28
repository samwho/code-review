export interface ImportDeclaration {
  type: 'import';
  source: string;
  imports: {
    name: string;
    alias?: string;
    isDefault?: boolean;
    isNamespace?: boolean;
  }[];
  line: number;
}

export interface ExportDeclaration {
  type: 'export';
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'const' | 'let' | 'var' | 'enum';
  isDefault?: boolean;
  line: number;
}

export interface SymbolReference {
  name: string;
  line: number;
  column: number;
  context: 'usage' | 'declaration' | 'assignment';
}

export interface FileAnalysis {
  filename: string;
  imports: ImportDeclaration[];
  exports: ExportDeclaration[];
  symbols: SymbolReference[];
  dependencies: string[];
}

export interface DependencyEdge {
  from: string;
  to: string;
  type: 'import' | 'reference';
  symbols: string[];
}

export interface DependencyGraph {
  nodes: Map<string, FileAnalysis>;
  edges: DependencyEdge[];
}

export class DependencyAnalyzer {
  private keywords = new Set([
    'abstract', 'any', 'as', 'async', 'await', 'boolean', 'break', 'case', 'catch', 'class',
    'const', 'constructor', 'continue', 'debugger', 'declare', 'default', 'delete', 'do',
    'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'from', 'function',
    'get', 'if', 'implements', 'import', 'in', 'instanceof', 'interface', 'is', 'keyof',
    'let', 'module', 'namespace', 'never', 'new', 'null', 'number', 'object', 'of',
    'package', 'private', 'protected', 'public', 'readonly', 'return', 'set', 'static',
    'string', 'super', 'switch', 'symbol', 'this', 'throw', 'true', 'try', 'type',
    'typeof', 'undefined', 'union', 'unknown', 'var', 'void', 'while', 'with', 'yield'
  ]);

  analyzeFile(filename: string, content: string): FileAnalysis {
    const lines = content.split('\n');
    const imports: ImportDeclaration[] = [];
    const exports: ExportDeclaration[] = [];
    const symbols: SymbolReference[] = [];
    const dependencies: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const lineNumber = i + 1;

      // Parse import statements
      const importMatch = this.parseImport(line, lineNumber);
      if (importMatch) {
        imports.push(importMatch);
        if (!dependencies.includes(importMatch.source)) {
          dependencies.push(importMatch.source);
        }
      }

      // Parse export statements
      const exportMatch = this.parseExport(line, lineNumber);
      if (exportMatch) {
        exports.push(exportMatch);
      }

      // Extract symbol references
      const lineSymbols = this.extractSymbols(line, lineNumber);
      symbols.push(...lineSymbols);
    }

    return {
      filename,
      imports,
      exports,
      symbols,
      dependencies
    };
  }

  private parseImport(line: string, lineNumber: number): ImportDeclaration | null {
    // Handle various import patterns
    const patterns = [
      // import { a, b } from 'module'
      /^import\s*\{\s*([^}]+)\s*\}\s*from\s*['"`]([^'"`]+)['"`]/,
      // import * as name from 'module'
      /^import\s*\*\s*as\s+(\w+)\s*from\s*['"`]([^'"`]+)['"`]/,
      // import name from 'module'
      /^import\s+(\w+)\s*from\s*['"`]([^'"`]+)['"`]/,
      // import 'module'
      /^import\s*['"`]([^'"`]+)['"`]/,
      // import name, { a, b } from 'module'
      /^import\s+(\w+)\s*,\s*\{\s*([^}]+)\s*\}\s*from\s*['"`]([^'"`]+)['"`]/
    ];

    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {
        return this.buildImportDeclaration(match, lineNumber);
      }
    }

    return null;
  }

  private buildImportDeclaration(match: RegExpMatchArray, lineNumber: number): ImportDeclaration {
    const imports: ImportDeclaration['imports'] = [];
    
    if (match[0].includes('* as')) {
      // namespace import
      return {
        type: 'import',
        source: match[2],
        imports: [{ name: match[1], isNamespace: true }],
        line: lineNumber
      };
    } else if (match[0].includes('{')) {
      // named imports
      const namedImports = match[1] || match[2];
      const source = match[2] || match[3];
      
      if (namedImports) {
        namedImports.split(',').forEach(imp => {
          const trimmed = imp.trim();
          const asMatch = trimmed.match(/(\w+)\s+as\s+(\w+)/);
          if (asMatch) {
            imports.push({ name: asMatch[1], alias: asMatch[2] });
          } else if (trimmed) {
            imports.push({ name: trimmed });
          }
        });
      }
      
      // Handle default + named imports
      if (match[1] && match[2]) {
        imports.unshift({ name: match[1], isDefault: true });
      }
      
      return {
        type: 'import',
        source,
        imports,
        line: lineNumber
      };
    } else if (match[1] && match[2]) {
      // default import
      return {
        type: 'import',
        source: match[2],
        imports: [{ name: match[1], isDefault: true }],
        line: lineNumber
      };
    } else {
      // side-effect import
      return {
        type: 'import',
        source: match[1],
        imports: [],
        line: lineNumber
      };
    }
  }

  private parseExport(line: string, lineNumber: number): ExportDeclaration | null {
    const patterns = [
      // export default class/function/const
      /^export\s+default\s+(class|function|const|let|var|interface|type|enum)\s+(\w+)/,
      // export class/function/const
      /^export\s+(class|function|const|let|var|interface|type|enum)\s+(\w+)/,
      // export { name }
      /^export\s*\{\s*(\w+)\s*\}/,
      // export default (expression)
      /^export\s+default\s+(\w+)/
    ];

    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {
        const isDefault = line.includes('default');
        
        if (match[2]) {
          return {
            type: 'export',
            name: match[2],
            kind: match[1] as ExportDeclaration['kind'],
            isDefault,
            line: lineNumber
          };
        } else {
          return {
            type: 'export',
            name: match[1],
            kind: 'const', // default for unknown
            isDefault,
            line: lineNumber
          };
        }
      }
    }

    return null;
  }

  private extractSymbols(line: string, lineNumber: number): SymbolReference[] {
    const symbols: SymbolReference[] = [];
    const tokens = this.tokenizeLine(line);
    
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      
      if (this.isIdentifier(token.value) && !this.keywords.has(token.value)) {
        const context = this.determineSymbolContext(tokens, i);
        symbols.push({
          name: token.value,
          line: lineNumber,
          column: token.column,
          context
        });
      }
    }
    
    return symbols;
  }

  private tokenizeLine(line: string) {
    const tokens: { value: string; column: number; type: string }[] = [];
    let i = 0;
    
    while (i < line.length) {
      const char = line[i];
      
      // Skip whitespace
      if (/\s/.test(char)) {
        i++;
        continue;
      }
      
      // Skip strings and comments
      if (char === '"' || char === "'" || char === '`') {
        const quote = char;
        i++;
        while (i < line.length && line[i] !== quote) {
          if (line[i] === '\\') i++; // Skip escaped characters
          i++;
        }
        i++;
        continue;
      }
      
      if (char === '/' && line[i + 1] === '/') {
        break; // Rest of line is comment
      }
      
      // Identifiers
      if (/[a-zA-Z_$]/.test(char)) {
        const start = i;
        while (i < line.length && /[a-zA-Z0-9_$]/.test(line[i])) {
          i++;
        }
        tokens.push({
          value: line.slice(start, i),
          column: start,
          type: 'identifier'
        });
        continue;
      }
      
      // Other characters (operators, punctuation)
      tokens.push({
        value: char,
        column: i,
        type: 'operator'
      });
      i++;
    }
    
    return tokens;
  }

  private isIdentifier(token: string): boolean {
    return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(token);
  }

  private determineSymbolContext(tokens: any[], index: number): SymbolReference['context'] {
    const prevToken = tokens[index - 1];
    const nextToken = tokens[index + 1];
    
    // Check for declarations
    if (prevToken && ['const', 'let', 'var', 'function', 'class', 'interface', 'type', 'enum'].includes(prevToken.value)) {
      return 'declaration';
    }
    
    // Check for assignments
    if (nextToken && nextToken.value === '=') {
      return 'assignment';
    }
    
    return 'usage';
  }

  buildDependencyGraph(files: Map<string, string>): DependencyGraph {
    const nodes = new Map<string, FileAnalysis>();
    const edges: DependencyEdge[] = [];
    
    // Analyze each file
    for (const [filename, content] of files) {
      const analysis = this.analyzeFile(filename, content);
      nodes.set(filename, analysis);
    }
    
    // Build edges based on dependencies
    for (const [filename, analysis] of nodes) {
      for (const dep of analysis.dependencies) {
        const resolvedDep = this.resolveModulePath(dep, filename, nodes);
        if (resolvedDep) {
          const importDecl = analysis.imports.find(imp => imp.source === dep);
          const symbols = importDecl?.imports.map(imp => imp.name) || [];
          
          edges.push({
            from: filename,
            to: resolvedDep,
            type: 'import',
            symbols
          });
        }
      }
    }
    
    return { nodes, edges };
  }

  private resolveModulePath(modulePath: string, currentFile: string, nodes: Map<string, FileAnalysis>): string | null {
    // Handle relative imports
    if (modulePath.startsWith('./') || modulePath.startsWith('../')) {
      const currentDir = currentFile.split('/').slice(0, -1);
      const pathParts = modulePath.split('/');
      
      for (const part of pathParts) {
        if (part === '.') continue;
        if (part === '..') {
          currentDir.pop();
        } else {
          currentDir.push(part);
        }
      }
      
      const resolvedPath = currentDir.join('/');
      
      // Try different extensions
      const extensions = ['.ts', '.js', '.tsx', '.jsx'];
      for (const ext of extensions) {
        const withExt = resolvedPath + ext;
        if (nodes.has(withExt)) {
          return withExt;
        }
      }
      
      // Try index files
      for (const ext of extensions) {
        const indexPath = resolvedPath + '/index' + ext;
        if (nodes.has(indexPath)) {
          return indexPath;
        }
      }
      
      return resolvedPath;
    }
    
    // For now, ignore external modules (npm packages)
    return null;
  }

  topologicalSort(graph: DependencyGraph, reverse: boolean = false): string[] {
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const result: string[] = [];
    
    const visit = (node: string) => {
      if (visiting.has(node)) {
        // Circular dependency detected - continue anyway
        return;
      }
      if (visited.has(node)) {
        return;
      }
      
      visiting.add(node);
      
      const dependencies = graph.edges
        .filter(edge => edge.from === node)
        .map(edge => edge.to);
      
      for (const dep of dependencies) {
        if (graph.nodes.has(dep)) {
          visit(dep);
        }
      }
      
      visiting.delete(node);
      visited.add(node);
      result.push(node);
    };
    
    // Visit all nodes
    for (const node of graph.nodes.keys()) {
      if (!visited.has(node)) {
        visit(node);
      }
    }
    
    return reverse ? result.reverse() : result;
  }
}