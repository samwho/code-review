/**
 * Git service for performing Git operations and integrating with dependency analysis
 */

import { spawn } from 'bun';
import { DependencyAnalyzer } from './dependency-analyzer';
import { DiffParser } from './parsers/diff-parser';
import { APP_CONFIG } from './config';
import { isSupportedSourceFile } from './utils/file-utils';
import type { 
  DiffLine, 
  FileDiff, 
  GitDiffResult,
  SerializedDependencyGraph,
  ModifiedFunctionEntry
} from './types/git';
import type { DependencyGraph, FunctionDefinition } from './types/analysis';

// Re-export types for backward compatibility
export type { DiffLine, FileDiff } from './types/git';

export class GitService {
  private readonly dependencyAnalyzer: DependencyAnalyzer;
  private readonly diffParser: DiffParser;
  private readonly repoPath: string;
  
  constructor(repoPath?: string) {
    this.repoPath = repoPath || APP_CONFIG.DEFAULT_REPO_PATH;
    this.dependencyAnalyzer = new DependencyAnalyzer();
    this.diffParser = new DiffParser();
  }

  /**
   * Gets the diff between two branches
   */
  async getDiff(baseBranch: string, compareBranch: string): Promise<FileDiff[]> {
    const output = await this.executeGitCommand([
      'diff', 
      '--no-color', 
      '--unified=3', 
      `${baseBranch}...${compareBranch}`
    ]);

    return this.diffParser.parse(output);
  }


  /**
   * Gets all available branches in the repository
   */
  async getBranches(): Promise<string[]> {
    const output = await this.executeGitCommand(['branch', '--format=%(refname:short)']);
    return output.trim().split('\n').filter(branch => branch.trim());
  }

  /**
   * Gets the contents of a specific file from a branch
   */
  async getFileContents(branch: string, filePath: string): Promise<string> {
    return await this.executeGitCommand(['show', `${branch}:${filePath}`]);
  }

  /**
   * Gets all supported source files in a specific branch
   */
  async getFilesInBranch(branch: string): Promise<string[]> {
    const output = await this.executeGitCommand(['ls-tree', '-r', '--name-only', branch]);
    return output.trim().split('\n').filter(file => 
      file.trim() && isSupportedSourceFile(file)
    );
  }

  /**
   * Executes a git command and returns the output
   */
  private async executeGitCommand(args: string[]): Promise<string> {
    const proc = spawn(['git', ...args], {
      cwd: this.repoPath,
      stdout: 'pipe',
      stderr: 'pipe'
    });

    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    
    if (exitCode !== 0) {
      const errorOutput = await new Response(proc.stderr).text();
      throw new Error(
        `Git command failed: git ${args.join(' ')}\nExit code: ${exitCode}\nError: ${errorOutput}`
      );
    }

    return output;
  }

  /**
   * Analyzes dependencies for all files in a branch
   */
  async analyzeDependencies(branch: string): Promise<DependencyGraph> {
    const files = await this.getFilesInBranch(branch);
    const fileContents = await this.loadFileContents(branch, files);
    return await this.dependencyAnalyzer.buildDependencyGraph(fileContents);
  }

  /**
   * Loads contents for multiple files from a branch
   */
  private async loadFileContents(
    branch: string, 
    files: string[]
  ): Promise<Map<string, string>> {
    const fileContents = new Map<string, string>();

    for (const file of files) {
      try {
        const content = await this.getFileContents(branch, file);
        fileContents.set(file, content);
      } catch (error) {
        console.warn(`Could not read file ${file}:`, error);
      }
    }

    return fileContents;
  }

  /**
   * Analyzes which functions were modified in the given file diffs
   */
  analyzeModifiedFunctions(
    files: FileDiff[], 
    graph: DependencyGraph
  ): Map<string, FunctionDefinition[]> {
    const modifiedFunctions = new Map<string, FunctionDefinition[]>();
    
    for (const file of files) {
      const modifiedInFile = this.findModifiedFunctionsInFile(file, graph);
      if (modifiedInFile.length > 0) {
        modifiedFunctions.set(file.filename, modifiedInFile);
      }
    }
    
    return modifiedFunctions;
  }

  /**
   * Finds modified functions in a single file
   */
  private findModifiedFunctionsInFile(
    file: FileDiff, 
    graph: DependencyGraph
  ): FunctionDefinition[] {
    const fileAnalysis = graph.nodes.get(file.filename);
    if (!fileAnalysis?.functions) {
      return [];
    }
    
    return fileAnalysis.functions.filter(func => 
      this.isFunctionModified(func, file.lines)
    );
  }

  /**
   * Checks if a function was modified based on diff lines
   */
  private isFunctionModified(
    func: FunctionDefinition, 
    lines: DiffLine[]
  ): boolean {
    return lines.some(line => {
      if (line.type === 'context' || line.isHunkHeader) {
        return false;
      }
      
      const changeLineNumber = line.type === 'added' 
        ? line.lineNumber 
        : line.oldLineNumber;
        
      return changeLineNumber && 
             changeLineNumber >= func.startLine && 
             changeLineNumber <= func.endLine;
    });
  }

  /**
   * Gets diff files ordered according to the specified strategy
   */
  async getOrderedFiles(
    baseBranch: string, 
    compareBranch: string, 
    orderType: 'top-down' | 'bottom-up' | 'alphabetical' = 'alphabetical'
  ): Promise<GitDiffResult> {
    const diff = await this.getDiff(baseBranch, compareBranch);
    
    if (orderType === 'alphabetical') {
      return { 
        files: this.sortFilesAlphabetically(diff) 
      };
    }

    return await this.getFilesWithDependencyOrder(
      diff, 
      compareBranch, 
      orderType
    );
  }

  /**
   * Sorts files alphabetically by filename
   */
  private sortFilesAlphabetically(files: FileDiff[]): FileDiff[] {
    return files.sort((a, b) => a.filename.localeCompare(b.filename));
  }

  /**
   * Gets files ordered by dependency analysis
   */
  private async getFilesWithDependencyOrder(
    diff: FileDiff[],
    compareBranch: string,
    orderType: 'top-down' | 'bottom-up'
  ): Promise<GitDiffResult> {
    try {
      const graph = await this.analyzeDependencies(compareBranch);
      const sortedFiles = this.sortFilesByDependencies(diff, graph, orderType);
      const modifiedFunctions = this.analyzeModifiedFunctions(sortedFiles, graph);
      const serializedGraph = this.serializeGraph(graph, modifiedFunctions);
      
      return { 
        files: sortedFiles, 
        graph: serializedGraph 
      };
    } catch (error) {
      console.warn('Failed to analyze dependencies, falling back to alphabetical order:', error);
      return { 
        files: this.sortFilesAlphabetically(diff) 
      };
    }
  }

  /**
   * Sorts files based on dependency order
   */
  private sortFilesByDependencies(
    files: FileDiff[],
    graph: DependencyGraph,
    orderType: 'top-down' | 'bottom-up'
  ): FileDiff[] {
    const orderedFilenames = this.dependencyAnalyzer.topologicalSort(
      graph, 
      orderType === 'top-down'
    );
    
    const fileOrder = new Map(
      orderedFilenames.map((file, index) => [file, index])
    );
    
    return files.sort((a, b) => {
      const orderA = fileOrder.get(a.filename) ?? 999999;
      const orderB = fileOrder.get(b.filename) ?? 999999;
      return orderA - orderB;
    });
  }

  /**
   * Converts graph to serializable format for client
   */
  private serializeGraph(
    graph: DependencyGraph,
    modifiedFunctions: Map<string, FunctionDefinition[]>
  ): SerializedDependencyGraph {
    return {
      nodes: Array.from(graph.nodes.entries()).map(([filename, analysis]) => ({
        filename,
        ...analysis
      })),
      edges: graph.edges,
      modifiedFunctions: Array.from(modifiedFunctions.entries()).map(
        ([filename, functions]): ModifiedFunctionEntry => ({
          filename,
          functions
        })
      )
    };
  }
}