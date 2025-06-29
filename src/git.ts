/**
 * Git service for performing Git operations and integrating with dependency analysis
 */

import { simpleGit } from 'simple-git';
import type { SimpleGit } from 'simple-git';
import { DiffParser } from './parsers/diff-parser';
import { DependencyAnalyzer } from './dependency-analyzer';
import { OxcSymbolExtractor, type OxcFileSymbols } from './oxc-symbol-extractor';
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
  symbols?: OxcFileSymbols[];
}

export class GitService {
  private readonly symbolExtractor: OxcSymbolExtractor;
  private readonly dependencyAnalyzer: DependencyAnalyzer;
  private readonly diffParser: DiffParser;
  private readonly repoPath: string;
  private readonly git: SimpleGit;
  
  constructor(repoPath?: string) {
    this.repoPath = repoPath || APP_CONFIG.DEFAULT_REPO_PATH;
    this.git = simpleGit(this.repoPath);
    this.symbolExtractor = new OxcSymbolExtractor(this.repoPath);
    this.dependencyAnalyzer = new DependencyAnalyzer(this.repoPath);
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
      // Extract changed filenames for smart loading
      const changedFilenames = diff.map(d => d.filename);
      
      // Build dependency graph with smart loading
      const graph = await this.analyzeDependencies(compareBranch, changedFilenames);
      
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
   * Analyzes dependencies for relevant files only (smart loading)
   */
  private async analyzeDependencies(branch: string, changedFiles?: string[]): Promise<DependencyGraph> {
    let files: string[];
    
    if (changedFiles && changedFiles.length > 0) {
      // Smart loading: get all files but prioritize changed files and their likely dependencies
      const allFiles = await this.getFilesInBranch(branch);
      
      // Start with changed files
      const relevantFiles = new Set(changedFiles);
      
      // Add files that might be imported by changed files (heuristic approach)
      for (const changedFile of changedFiles) {
        const dir = changedFile.substring(0, changedFile.lastIndexOf('/'));
        
        // Add files in the same directory and common dependency patterns
        for (const file of allFiles) {
          if (
            file.startsWith(dir) || // Same directory
            file.includes('/models/') || // Common models
            file.includes('/types/') || // Type definitions
            file.includes('/utils/') || // Utilities
            file.includes('/services/') // Services
          ) {
            relevantFiles.add(file);
          }
        }
      }
      
      files = Array.from(relevantFiles);
      console.log(`Smart loading: reduced from ${allFiles.length} to ${files.length} files`);
    } else {
      // Fallback to loading all files
      files = await this.getFilesInBranch(branch);
    }
    
    const fileContents = await this.loadFileContents(branch, files);
    return await this.dependencyAnalyzer.buildDependencyGraph(fileContents);
  }

  /**
   * Loads contents for multiple files from a branch in parallel
   */
  private async loadFileContents(
    branch: string, 
    files: string[]
  ): Promise<Map<string, string>> {
    const fileContents = new Map<string, string>();

    // Load files in parallel instead of sequentially
    const filePromises = files.map(async (file) => {
      try {
        const content = await this.getFileContents(branch, file);
        return { file, content, success: true };
      } catch (error) {
        console.warn(`Could not read file ${file}:`, error);
        return { file, content: '', success: false };
      }
    });

    const results = await Promise.all(filePromises);
    
    // Only add successfully loaded files to the map
    for (const result of results) {
      if (result.success) {
        fileContents.set(result.file, result.content);
      }
    }

    return fileContents;
  }

}