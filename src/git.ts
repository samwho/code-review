/**
 * Git service for performing Git operations and integrating with dependency analysis
 */

import { simpleGit } from 'simple-git';
import type { SimpleGit } from 'simple-git';
import { DiffParser } from './parsers/diff-parser';
import { DependencyAnalyzer } from './dependency-analyzer';
import { SimpleSymbolExtractor, type FileSymbols } from './simple-symbol-extractor';
import { APP_CONFIG } from './config';
import { isSupportedSourceFile } from './utils/file-utils';
import type { 
  DiffLine, 
  FileDiff
} from './types/git';
import type { DependencyGraph } from './types/analysis';

// Re-export types for backward compatibility
export type { DiffLine, FileDiff } from './types/git';

export interface SimplifiedDiffResult {
  files: FileDiff[];
  symbols?: FileSymbols[];
}

export class GitService {
  private readonly symbolExtractor: SimpleSymbolExtractor;
  private readonly dependencyAnalyzer: DependencyAnalyzer;
  private readonly diffParser: DiffParser;
  private readonly repoPath: string;
  private readonly git: SimpleGit;
  
  constructor(repoPath?: string) {
    this.repoPath = repoPath || APP_CONFIG.DEFAULT_REPO_PATH;
    this.git = simpleGit(this.repoPath);
    this.symbolExtractor = new SimpleSymbolExtractor(this.repoPath);
    this.dependencyAnalyzer = new DependencyAnalyzer();
    this.diffParser = new DiffParser();
  }

  /**
   * Gets the diff between two branches
   */
  async getDiff(baseBranch: string, compareBranch: string): Promise<FileDiff[]> {
    const output = await this.git.diff([
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
    const branchSummary = await this.git.branch();
    return branchSummary.all;
  }

  /**
   * Gets the contents of a specific file from a branch
   */
  async getFileContents(branch: string, filePath: string): Promise<string> {
    return await this.git.show([`${branch}:${filePath}`]);
  }

  /**
   * Gets all supported source files in a specific branch
   */
  async getFilesInBranch(branch: string): Promise<string[]> {
    const output = await this.git.raw(['ls-tree', '-r', '--name-only', branch]);
    return output.trim().split('\n').filter(file => 
      file.trim() && isSupportedSourceFile(file)
    );
  }



  /**
   * Gets diff files with simple symbol extraction from changed files only
   */
  async getOrderedFiles(
    baseBranch: string, 
    compareBranch: string, 
    orderType: 'top-down' | 'bottom-up' | 'alphabetical' = 'alphabetical'
  ): Promise<SimplifiedDiffResult> {
    const diff = await this.getDiff(baseBranch, compareBranch);
    
    let sortedFiles: FileDiff[];
    if (orderType === 'alphabetical') {
      sortedFiles = this.sortFilesAlphabetically(diff);
    } else {
      // Use dependency analysis for ordering but don't expose the full graph
      sortedFiles = await this.sortFilesByDependencies(diff, compareBranch, orderType);
    }
    
    // Extract symbols only from the changed files
    const symbols = await this.symbolExtractor.extractFromChangedFiles(sortedFiles, compareBranch);
    
    return { 
      files: sortedFiles,
      symbols 
    };
  }

  /**
   * Sorts files alphabetically by filename
   */
  private sortFilesAlphabetically(files: FileDiff[]): FileDiff[] {
    return files.sort((a, b) => a.filename.localeCompare(b.filename));
  }

  /**
   * Sorts files based on dependency order (for ordering only, doesn't expose full graph)
   */
  private async sortFilesByDependencies(
    diff: FileDiff[],
    compareBranch: string,
    orderType: 'top-down' | 'bottom-up'
  ): Promise<FileDiff[]> {
    try {
      // Build dependency graph just for ordering
      const graph = await this.analyzeDependencies(compareBranch);
      
      const orderedFilenames = this.dependencyAnalyzer.topologicalSort(
        graph, 
        orderType === 'top-down'
      );
      
      const fileOrder = new Map(
        orderedFilenames.map((file, index) => [file, index])
      );
      
      const sorted = diff.sort((a, b) => {
        const orderA = fileOrder.get(a.filename) ?? 999999;
        const orderB = fileOrder.get(b.filename) ?? 999999;
        return orderA - orderB;
      });
      
      return sorted;
    } catch (error) {
      console.warn('Failed to analyze dependencies for ordering, falling back to alphabetical:', error);
      return this.sortFilesAlphabetically(diff);
    }
  }

  /**
   * Analyzes dependencies for all files in a branch (for ordering only)
   */
  private async analyzeDependencies(branch: string): Promise<DependencyGraph> {
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

}