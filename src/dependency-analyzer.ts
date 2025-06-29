/**
 * Dependency analyzer using OXC parser for accurate dependency extraction
 */

import { OxcSymbolExtractor } from './oxc-symbol-extractor';
import type {
  DependencyEdge,
  DependencyGraph,
  ExportDeclaration,
  FileAnalysis,
  ImportDeclaration,
} from './types/analysis';

export class DependencyAnalyzer {
  private oxcExtractor: OxcSymbolExtractor;

  constructor(repoPath?: string) {
    this.oxcExtractor = new OxcSymbolExtractor(repoPath);
  }

  /**
   * Analyzes a single file and extracts dependency information using OXC
   */
  async analyzeFile(filename: string, content: string): Promise<FileAnalysis> {
    // Use OXC to parse dependencies
    const dependencies = this.oxcExtractor.extractDependenciesFromContent(content, filename);

    // Convert OXC types to analysis types
    const imports: ImportDeclaration[] = dependencies.imports.map((imp) => ({
      type: 'import' as const,
      source: imp.module || '',
      imports: imp.importedSymbols.map((name) => ({ name })),
      line: imp.line || 0,
    }));

    const exports: ExportDeclaration[] = dependencies.exports.map((exp) => ({
      type: 'export' as const,
      name: exp.exportedSymbols[0] || 'default',
      kind: 'const' as const,
      line: exp.line || 0,
    }));

    return {
      filename,
      imports,
      exports,
      symbols: [],
      dependencies: imports
        .filter((imp) => imp.source.startsWith('./') || imp.source.startsWith('../'))
        .map((imp) => imp.source),
      functions: [],
      semanticSymbols: [],
    };
  }

  /**
   * Build dependency graph from files
   */
  async buildDependencyGraph(files: Map<string, string>): Promise<DependencyGraph> {
    const nodes = new Map<string, FileAnalysis>();
    const edges: DependencyEdge[] = [];

    // Analyze all files
    for (const filename of Array.from(files.keys())) {
      const content = files.get(filename);
      if (content !== undefined) {
        const analysis = await this.analyzeFile(filename, content);
        nodes.set(filename, analysis);
      }
    }

    // Build edges based on imports
    for (const filename of Array.from(nodes.keys())) {
      const analysis = nodes.get(filename);
      if (analysis) {
        for (const imp of analysis.imports) {
          if (imp.source.startsWith('./') || imp.source.startsWith('../')) {
            const resolvedPath = this.resolveModulePath(imp.source, filename, nodes);
            if (resolvedPath) {
              edges.push({
                from: filename,
                to: resolvedPath,
                type: 'import',
                symbols: imp.imports.map((spec) => spec.name),
              });
            }
          }
        }
      }
    }

    return { nodes, edges };
  }

  /**
   * Simple module path resolution
   */
  private resolveModulePath(
    modulePath: string,
    currentFile: string,
    nodes: Map<string, FileAnalysis>
  ): string | null {
    if (!this.isRelativeImport(modulePath)) {
      return null;
    }

    const resolvedPath = this.buildResolvedPath(modulePath, currentFile);
    return this.findMatchingFile(resolvedPath, nodes);
  }

  /**
   * Topological sort for dependency ordering
   */
  topologicalSort(graph: DependencyGraph, topDown = true): string[] {
    const { nodes, edges } = graph;
    const { inDegree, adjList } = this.initializeGraphStructures(nodes, edges);

    const result = this.executeKahnsAlgorithm(inDegree, adjList);

    if (this.hasCycle(result, nodes)) {
      return this.getFallbackOrder(nodes);
    }

    return topDown ? result : result.reverse();
  }

  /**
   * Initialize graph data structures for topological sort
   */
  private initializeGraphStructures(
    nodes: Map<string, FileAnalysis>,
    edges: DependencyEdge[]
  ): {
    inDegree: Map<string, number>;
    adjList: Map<string, string[]>;
  } {
    const inDegree = new Map<string, number>();
    const adjList = new Map<string, string[]>();

    // Initialize all nodes
    for (const filename of Array.from(nodes.keys())) {
      inDegree.set(filename, 0);
      adjList.set(filename, []);
    }

    // Build adjacency list and in-degree count
    for (const edge of edges) {
      adjList.get(edge.from)?.push(edge.to);
      inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
    }

    return { inDegree, adjList };
  }

  /**
   * Execute Kahn's algorithm for topological sorting
   */
  private executeKahnsAlgorithm(
    inDegree: Map<string, number>,
    adjList: Map<string, string[]>
  ): string[] {
    const queue = this.getNodesWithNoDependencies(inDegree);
    const result: string[] = [];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        break;
      }

      result.push(current);
      this.processNeighbors(current, adjList, inDegree, queue);
    }

    return result;
  }

  /**
   * Get nodes with no dependencies to start the algorithm
   */
  private getNodesWithNoDependencies(inDegree: Map<string, number>): string[] {
    const queue: string[] = [];

    for (const filename of Array.from(inDegree.keys())) {
      const degree = inDegree.get(filename);
      if (degree === 0) {
        queue.push(filename);
      }
    }

    return queue;
  }

  /**
   * Process neighbors of current node in topological sort
   */
  private processNeighbors(
    current: string,
    adjList: Map<string, string[]>,
    inDegree: Map<string, number>,
    queue: string[]
  ): void {
    const neighbors = adjList.get(current) || [];

    for (const neighbor of neighbors) {
      const newDegree = (inDegree.get(neighbor) || 0) - 1;
      inDegree.set(neighbor, newDegree);

      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  /**
   * Check if there's a cycle in the graph
   */
  private hasCycle(result: string[], nodes: Map<string, FileAnalysis>): boolean {
    return result.length !== nodes.size;
  }

  /**
   * Get fallback alphabetical order when cycle is detected
   */
  private getFallbackOrder(nodes: Map<string, FileAnalysis>): string[] {
    return Array.from(nodes.keys()).sort();
  }

  /**
   * Check if import is relative
   */
  private isRelativeImport(modulePath: string): boolean {
    return modulePath.startsWith('./') || modulePath.startsWith('../');
  }

  /**
   * Build resolved path from module path and current file
   */
  private buildResolvedPath(modulePath: string, currentFile: string): string {
    const currentDir = currentFile.substring(0, currentFile.lastIndexOf('/'));
    let resolvedPath = `${currentDir}/${modulePath}`;

    // Normalize path
    resolvedPath = this.normalizePath(resolvedPath);

    return resolvedPath;
  }

  /**
   * Normalize path by removing ./ and ../
   */
  private normalizePath(path: string): string {
    return path.replace(/\/\.\//g, '/').replace(/\/[^/]+\/\.\./g, '');
  }

  /**
   * Find matching file with extensions
   */
  private findMatchingFile(resolvedPath: string, nodes: Map<string, FileAnalysis>): string | null {
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.js'];

    for (const ext of extensions) {
      const candidate = resolvedPath + ext;
      if (nodes.has(candidate)) {
        return candidate;
      }
    }

    return null;
  }
}
