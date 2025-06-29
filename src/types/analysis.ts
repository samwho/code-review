/**
 * Type definitions for code analysis
 */

export interface ImportDeclaration {
  type: 'import';
  source: string;
  imports: ImportSpecifier[];
  line: number;
}

export interface ImportSpecifier {
  name: string;
  alias?: string;
  isDefault?: boolean;
  isNamespace?: boolean;
}

export interface ExportDeclaration {
  type: 'export';
  name: string;
  kind: ExportKind;
  isDefault?: boolean;
  line: number;
}

export type ExportKind =
  | 'function'
  | 'class'
  | 'interface'
  | 'type'
  | 'const'
  | 'let'
  | 'var'
  | 'enum';

export interface SymbolReference {
  name: string;
  line: number;
  column: number;
  context: SymbolContext;
}

export type SymbolContext = 'usage' | 'declaration' | 'assignment';

export interface FunctionDefinition {
  name: string;
  startLine: number;
  endLine: number;
  isExported: boolean;
  isAsync: boolean;
  parameters: string[];
}

export interface FileAnalysis {
  filename: string;
  imports: ImportDeclaration[];
  exports: ExportDeclaration[];
  symbols: SymbolReference[];
  dependencies: string[];
  functions: FunctionDefinition[];
  semanticSymbols?: import('../semantic-analyzer').SemanticSymbol[];
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
  modifiedFunctions?: Map<string, FunctionDefinition[]>;
}

export interface Token {
  value: string;
  column: number;
  type: TokenType;
}

export type TokenType = 'identifier' | 'operator' | 'string' | 'comment';
