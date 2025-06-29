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
    // Only handle relative imports
    if (!(modulePath.startsWith('./') || modulePath.startsWith('../'))) {
      return null;
    }

    // Simple path resolution (this is basic and could be improved)
    const currentDir = currentFile.substring(0, currentFile.lastIndexOf('/'));
    let resolvedPath = `${currentDir}/${modulePath}`;

    // Normalize path
    resolvedPath = resolvedPath.replace(/\/\.\//g, '/').replace(/\/[^/]+\/\.\./g, '');

    // Try different extensions
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.js'];

    for (const ext of extensions) {
      const candidate = resolvedPath + ext;
      if (nodes.has(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  /**
   * Topological sort for dependency ordering
   */
  topologicalSort(graph: DependencyGraph, topDown = true): string[] {
    const { nodes, edges } = graph;
    const inDegree = new Map<string, number>();
    const adjList = new Map<string, string[]>();

    // Initialize
    for (const filename of Array.from(nodes.keys())) {
      inDegree.set(filename, 0);
      adjList.set(filename, []);
    }

    // Build adjacency list and in-degree count
    for (const edge of edges) {
      adjList.get(edge.from)?.push(edge.to);
      inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
    }

    // Kahn's algorithm
    const queue: string[] = [];
    const result: string[] = [];

    // Start with nodes that have no dependencies
    for (const filename of Array.from(inDegree.keys())) {
      const degree = inDegree.get(filename);
      if (degree === 0) {
        queue.push(filename);
      }
    }

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        break;
      }
      result.push(current);

      const neighbors = adjList.get(current) || [];
      for (const neighbor of neighbors) {
        const newDegree = (inDegree.get(neighbor) || 0) - 1;
        inDegree.set(neighbor, newDegree);

        if (newDegree === 0) {
          queue.push(neighbor);
        }
      }
    }

    // If result doesn't contain all nodes, there's a cycle
    if (result.length !== nodes.size) {
      // Return alphabetical order as fallback
      return Array.from(nodes.keys()).sort();
    }

    // For bottom-up ordering, reverse the result (dependencies first)
    return topDown ? result : result.reverse();
  }
}
