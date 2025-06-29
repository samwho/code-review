/**
 * Type definitions for Git operations
 */

export interface DiffLine {
  type: DiffLineType;
  content: string;
  lineNumber?: number;
  oldLineNumber?: number;
  isHunkHeader?: boolean;
}

export type DiffLineType = 'added' | 'removed' | 'context';

export interface FileDiff {
  filename: string;
  oldFilename?: string;
  lines: DiffLine[];
  isNew: boolean;
  isDeleted: boolean;
}

export interface GitDiffResult {
  files: FileDiff[];
  graph?: SerializedDependencyGraph;
}

export interface SerializedDependencyGraph {
  nodes: SerializedFileAnalysis[];
  edges: import('./analysis').DependencyEdge[];
  modifiedFunctions?: ModifiedFunctionEntry[];
}

export interface SerializedFileAnalysis {
  filename: string;
  imports: import('./analysis').ImportDeclaration[];
  exports: import('./analysis').ExportDeclaration[];
  symbols: import('./analysis').SymbolReference[];
  dependencies: string[];
  functions: import('./analysis').FunctionDefinition[];
  semanticSymbols?: import('../semantic-analyzer').SemanticSymbol[];
}

export interface ModifiedFunctionEntry {
  filename: string;
  functions: import('./analysis').FunctionDefinition[];
}
