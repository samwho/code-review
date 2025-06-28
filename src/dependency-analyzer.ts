/**
 * Dependency analyzer for building dependency graphs from TypeScript/JavaScript code
 * Now uses ts-morph exclusively for all parsing
 */

import { TSMorphAnalyzer, type ParsedSymbol } from './ts-morph-analyzer';
import type {
  ImportDeclaration,
  ExportDeclaration,
  SymbolReference,
  SymbolContext,
  FunctionDefinition,
  FileAnalysis,
  DependencyEdge,
  DependencyGraph
} from './types/analysis';

// Re-export types for backward compatibility
export type {
  ImportDeclaration,
  ExportDeclaration,
  SymbolReference,
  FunctionDefinition,
  FileAnalysis,
  DependencyEdge,
  DependencyGraph
} from './types/analysis';

export class DependencyAnalyzer {
  private readonly tsMorphAnalyzer: TSMorphAnalyzer;

  constructor() {
    this.tsMorphAnalyzer = new TSMorphAnalyzer();
  }

  /**
   * Analyzes a single file and extracts all relevant information
   * This method is now a wrapper around the unified ts-morph analyzer
   */
  async analyzeFile(filename: string, content: string): Promise<FileAnalysis> {
    // Use the unified ts-morph analyzer
    const fileMap = new Map([[filename, content]]);
    const analyses = await this.tsMorphAnalyzer.analyzeFiles(fileMap);
    const analysis = analyses.get(filename);
    
    if (!analysis) {
      // Fallback if analysis failed
      return {
        filename,
        imports: [],
        exports: [],
        symbols: [],
        dependencies: [],
        functions: [],
        semanticSymbols: []
      };
    }

    // Convert to legacy format for backward compatibility
    const legacyImports: ImportDeclaration[] = analysis.imports.map(imp => ({
      type: 'import' as const,
      source: imp.source,
      imports: imp.imports.map(spec => ({
        name: spec.name,
        alias: spec.alias,
        isDefault: spec.isDefault,
        isNamespace: spec.isNamespace
      })),
      line: imp.line
    }));

    const legacyExports: ExportDeclaration[] = analysis.exports.map(exp => ({
      type: 'export' as const,
      name: exp.name,
      kind: exp.kind,
      isDefault: exp.isDefault,
      line: exp.line
    }));

    const legacyFunctions: FunctionDefinition[] = analysis.functions.map(func => ({
      name: func.name,
      startLine: func.startLine,
      endLine: func.endLine,
      isExported: func.isExported,
      isAsync: func.isAsync,
      parameters: func.parameters
    }));

    const legacySymbols: SymbolReference[] = analysis.symbols.map(sym => ({
      name: sym.name,
      line: sym.line,
      column: sym.column,
      context: this.inferSymbolContext(sym)
    }));

    return {
      filename,
      imports: legacyImports,
      exports: legacyExports,
      symbols: legacySymbols,
      dependencies: analysis.dependencies,
      functions: legacyFunctions,
      semanticSymbols: analysis.symbols // Store the full semantic symbols
    };
  }


  /**
   * Builds a complete dependency graph from a set of files
   */
  async buildDependencyGraph(files: Map<string, string>): Promise<DependencyGraph> {
    const nodes = new Map<string, FileAnalysis>();
    const edges: DependencyEdge[] = [];
    
    // Use the unified ts-morph analyzer for all files at once
    const tsMorphAnalyses = await this.tsMorphAnalyzer.analyzeFiles(files);
    
    // Convert each analysis to the legacy format
    for (const [filename, content] of files) {
      const analysis = await this.analyzeFile(filename, content);
      nodes.set(filename, analysis);
    }
    
    // Build edges based on dependencies
    for (const [filename, analysis] of nodes) {
      this.buildEdgesForFile(filename, analysis, nodes, edges);
    }
    
    return { nodes, edges };
  }

  /**
   * Builds dependency edges for a single file
   */
  private buildEdgesForFile(
    filename: string,
    analysis: FileAnalysis,
    nodes: Map<string, FileAnalysis>,
    edges: DependencyEdge[]
  ): void {
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

  /**
   * Resolves a module path to an actual file path
   */
  private resolveModulePath(
    modulePath: string, 
    currentFile: string, 
    nodes: Map<string, FileAnalysis>
  ): string | null {
    // Only handle relative imports
    if (!this.isRelativeImport(modulePath)) {
      return null; // Ignore external modules
    }

    const resolvedPath = this.computeResolvedPath(modulePath, currentFile);
    
    // Try to find the file with various extensions
    const possiblePaths = this.generatePossiblePaths(resolvedPath);
    
    for (const path of possiblePaths) {
      if (nodes.has(path)) {
        return path;
      }
    }
    
    return resolvedPath;
  }

  private isRelativeImport(modulePath: string): boolean {
    return modulePath.startsWith('./') || modulePath.startsWith('../');
  }

  private computeResolvedPath(modulePath: string, currentFile: string): string {
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
    
    return currentDir.join('/');
  }

  private generatePossiblePaths(basePath: string): string[] {
    const extensions = ['.ts', '.js', '.tsx', '.jsx'];
    const paths: string[] = [];
    
    // Try direct path with extensions
    for (const ext of extensions) {
      paths.push(basePath + ext);
    }
    
    // Try index files
    for (const ext of extensions) {
      paths.push(basePath + '/index' + ext);
    }
    
    return paths;
  }


  /**
   * Performs topological sort on the dependency graph
   * @param graph The dependency graph to sort
   * @param reverse If true, returns reverse topological order (bottom-up)
   * @returns Array of filenames in topological order
   */
  topologicalSort(graph: DependencyGraph, reverse: boolean = false): string[] {
    const sortResult = this.performTopologicalSort(graph);
    return reverse ? sortResult.reverse() : sortResult;
  }

  private performTopologicalSort(graph: DependencyGraph): string[] {
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const result: string[] = [];
    
    // Visit all nodes
    for (const node of graph.nodes.keys()) {
      if (!visited.has(node)) {
        this.visitNode(node, graph, visited, visiting, result);
      }
    }
    
    return result;
  }

  private visitNode(
    node: string,
    graph: DependencyGraph,
    visited: Set<string>,
    visiting: Set<string>,
    result: string[]
  ): void {
    if (visiting.has(node)) {
      // Circular dependency detected - continue anyway
      return;
    }
    if (visited.has(node)) {
      return;
    }
    
    visiting.add(node);
    
    // Visit all dependencies first
    const dependencies = this.getNodeDependencies(node, graph);
    for (const dep of dependencies) {
      if (graph.nodes.has(dep)) {
        this.visitNode(dep, graph, visited, visiting, result);
      }
    }
    
    visiting.delete(node);
    visited.add(node);
    result.push(node);
  }

  private getNodeDependencies(node: string, graph: DependencyGraph): string[] {
    return graph.edges
      .filter(edge => edge.from === node)
      .map(edge => edge.to);
  }

  /**
   * Infers symbol context from semantic information
   */
  private inferSymbolContext(symbol: ParsedSymbol): SymbolContext {
    if (symbol.isExported) {
      return 'declaration';
    }
    
    // Use the semantic kind to infer context
    switch (symbol.kind) {
      case 'function':
      case 'method':
      case 'class':
      case 'interface':
      case 'type':
      case 'enum':
        return 'declaration';
      case 'variable':
      case 'parameter':
        return 'assignment';
      default:
        return 'usage';
    }
  }
}