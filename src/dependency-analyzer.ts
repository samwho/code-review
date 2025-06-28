/**
 * Dependency analyzer for building dependency graphs from TypeScript/JavaScript code
 */

import { SemanticAnalyzer } from './semantic-analyzer';
import { APP_CONFIG } from './config';
import { ImportParser } from './analyzers/import-parser';
import { ExportParser } from './analyzers/export-parser';
import { FunctionParser } from './analyzers/function-parser';
import { SymbolExtractor } from './analyzers/symbol-extractor';
import type {
  ImportDeclaration,
  ExportDeclaration,
  SymbolReference,
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
  private readonly semanticAnalyzer: SemanticAnalyzer;
  private readonly importParser: ImportParser;
  private readonly exportParser: ExportParser;
  private readonly functionParser: FunctionParser;
  private readonly symbolExtractor: SymbolExtractor;

  constructor() {
    this.semanticAnalyzer = new SemanticAnalyzer();
    this.importParser = new ImportParser();
    this.exportParser = new ExportParser();
    this.functionParser = new FunctionParser();
    this.symbolExtractor = new SymbolExtractor(APP_CONFIG.TYPESCRIPT_KEYWORDS);
  }

  /**
   * Analyzes a single file and extracts all relevant information
   */
  analyzeFile(filename: string, content: string): FileAnalysis {
    const lines = content.split('\n');
    const imports: ImportDeclaration[] = [];
    const exports: ExportDeclaration[] = [];
    const symbols: SymbolReference[] = [];
    const dependencies: string[] = [];

    // Parse each line for imports, exports, and symbols
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const lineNumber = i + 1;

      // Parse imports
      const importDeclaration = this.importParser.parse(line, lineNumber);
      if (importDeclaration) {
        imports.push(importDeclaration);
        if (!dependencies.includes(importDeclaration.source)) {
          dependencies.push(importDeclaration.source);
        }
      }

      // Parse exports
      const exportDeclaration = this.exportParser.parse(line, lineNumber);
      if (exportDeclaration) {
        exports.push(exportDeclaration);
      }

      // Extract symbols
      const lineSymbols = this.symbolExtractor.extractSymbols(line, lineNumber);
      symbols.push(...lineSymbols);
    }

    // Extract function definitions
    const functions = this.functionParser.extractFunctions(content);

    return {
      filename,
      imports,
      exports,
      symbols,
      dependencies,
      functions
    };
  }


  /**
   * Builds a complete dependency graph from a set of files
   */
  async buildDependencyGraph(files: Map<string, string>): Promise<DependencyGraph> {
    const nodes = new Map<string, FileAnalysis>();
    const edges: DependencyEdge[] = [];
    
    // Perform semantic analysis on all files
    const semanticAnalyses = await this.semanticAnalyzer.analyzeFiles(files);
    
    // Analyze each file
    for (const [filename, content] of files) {
      const analysis = this.analyzeFile(filename, content);
      
      // Add semantic information if available
      const semanticAnalysis = semanticAnalyses.get(filename);
      if (semanticAnalysis) {
        analysis.semanticSymbols = semanticAnalysis.symbols;
      }
      
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
}