/**
 * Dependency analyzer using OXC parser for accurate dependency extraction
 */

import { OxcSymbolExtractor, type OxcImport, type OxcExport } from './oxc-symbol-extractor';
import type {
  ImportDeclaration,
  ExportDeclaration,
  SymbolReference,
  FileAnalysis,
  DependencyNode,
  DependencyEdge,
  DependencyGraph
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
    const imports: ImportDeclaration[] = dependencies.imports.map(imp => ({
      module: imp.module,
      isRelative: imp.isRelative,
      importedSymbols: imp.importedSymbols,
      line: imp.line
    }));

    const exports: ExportDeclaration[] = dependencies.exports.map(exp => ({
      module: exp.module,
      exportedSymbols: exp.exportedSymbols,
      isReExport: exp.isReExport,
      line: exp.line
    }));
    
    return {
      filename,
      imports,
      exports,
      symbols: [],
      dependencies: imports.filter(imp => imp.isRelative).map(imp => imp.module),
      functions: [],
      semanticSymbols: []
    };
  }


  /**
   * Build dependency graph from files
   */
  async buildDependencyGraph(files: Map<string, string>): Promise<DependencyGraph> {
    const nodes = new Map<string, FileAnalysis>();
    const edges: DependencyEdge[] = [];

    // Analyze all files
    for (const [filename, content] of files) {
      const analysis = await this.analyzeFile(filename, content);
      nodes.set(filename, analysis);
      
      // Debug: print what dependencies we found
      console.log(`${filename} dependencies:`, analysis.dependencies);
    }

    // Build edges based on imports
    for (const [filename, analysis] of nodes) {
      for (const imp of analysis.imports) {
        if (imp.isRelative) {
          const resolvedPath = this.resolveModulePath(imp.module, filename, nodes);
          console.log(`Resolving ${imp.module} from ${filename} -> ${resolvedPath}`);
          if (resolvedPath) {
            edges.push({
              from: filename,
              to: resolvedPath,
              type: 'import',
              symbols: imp.importedSymbols
            });
            console.log(`Added edge: ${filename} -> ${resolvedPath}`);
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
    if (!modulePath.startsWith('./') && !modulePath.startsWith('../')) {
      return null;
    }

    // Simple path resolution (this is basic and could be improved)
    const currentDir = currentFile.substring(0, currentFile.lastIndexOf('/'));
    let resolvedPath = currentDir + '/' + modulePath;
    
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
    for (const filename of nodes.keys()) {
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
    for (const [filename, degree] of inDegree) {
      if (degree === 0) {
        queue.push(filename);
      }
    }
    
    while (queue.length > 0) {
      const current = queue.shift()!;
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
      console.log('Cycle detected, returning alphabetical order');
      // Return alphabetical order as fallback
      return Array.from(nodes.keys()).sort();
    }
    
    console.log('Topological sort result:', result);
    
    // For bottom-up ordering, reverse the result (dependencies first)
    return topDown ? result : result.reverse();
  }
}