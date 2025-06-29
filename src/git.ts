/**
 * Git service for performing Git operations and integrating with dependency analysis
 */

import { simpleGit } from 'simple-git';
import type { SimpleGit } from 'simple-git';
import { DiffParser } from './parsers/diff-parser';
import { DependencyAnalyzer } from './dependency-analyzer';
import { OxcSymbolExtractor, type OxcFileSymbols } from './oxc-symbol-extractor';
import { 
  extractSymbolReferencesFromContent, 
  lineContainsAnySymbol,
  type FileSymbolReferences 
} from './utils/oxc-symbol-reference-extractor';
import { APP_CONFIG } from './config';
import { isSupportedSourceFile } from './utils/file-utils';
import type { 
  DiffLine, 
  FileDiff
} from './types/git';
import type { DependencyGraph } from './types/analysis';

// Re-export types for backward compatibility
export type { DiffLine, FileDiff } from './types/git';

export interface SymbolReference {
  file: string;
  line: number;
  type: 'added' | 'removed' | 'context';
  context: string;
  content: string;
}

export interface PreprocessedSymbol {
  name: string;
  filename: string;
  line: number;
  type: string;
  isExported: boolean;
  className?: string;
  references: SymbolReference[];
}

export interface SimplifiedDiffResult {
  files: FileDiff[];
  symbols?: OxcFileSymbols[];
  symbolReferences?: PreprocessedSymbol[];
}

export class GitService {
  private readonly symbolExtractor: OxcSymbolExtractor;
  private readonly dependencyAnalyzer: DependencyAnalyzer;
  private readonly diffParser: DiffParser;
  private readonly repoPath: string;
  private readonly git: SimpleGit;
  
  // Cache for precomputed symbol references per file
  private readonly symbolReferencesCache = new Map<string, FileSymbolReferences>();
  
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
    
    // Precompute symbol references using OXC for fast lookups
    await this.precomputeSymbolReferences(symbols, sortedFiles);
    
    // Pre-process symbol references to eliminate frontend processing
    const symbolReferences = await this.preprocessSymbolReferences(symbols, sortedFiles);
    
    return { 
      files: sortedFiles,
      symbols,
      symbolReferences
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

  /**
   * Load current content of a file from git
   */
  private async loadFileContent(filename: string): Promise<string | null> {
    try {
      const content = await this.git.show(['HEAD:' + filename]);
      return content;
    } catch (error) {
      console.warn(`Failed to load content for ${filename}:`, error);
      return null;
    }
  }

  /**
   * Precompute symbol references for all files using OXC
   */
  private async precomputeSymbolReferences(symbols: OxcFileSymbols[], diffFiles: FileDiff[]): Promise<void> {
    // Create set of all symbol names for efficient lookup
    const allSymbolNames = new Set<string>();
    symbols.forEach(fileSymbols => {
      fileSymbols.symbols.forEach(symbol => {
        allSymbolNames.add(symbol.name);
      });
    });

    // Process each diff file to extract symbol references
    const promises = diffFiles.map(async (file) => {
      if (!this.isHighlightableLanguage(this.detectLanguageFromFilename(file.filename))) {
        return;
      }

      try {
        // Load current file content from git
        const content = await this.loadFileContent(file.filename);
        if (!content) return;

        // Extract all symbol references using OXC
        const references = extractSymbolReferencesFromContent(content, file.filename, allSymbolNames);
        
        // Cache the results
        this.symbolReferencesCache.set(file.filename, {
          filename: file.filename,
          references
        });

        console.log(`🔍 Precomputed ${references.length} symbol references in ${file.filename}`);
      } catch (error) {
        console.warn(`Failed to precompute symbol references for ${file.filename}:`, error);
      }
    });

    await Promise.all(promises);
  }

  /**
   * Pre-process symbol references to eliminate expensive frontend processing
   */
  private async preprocessSymbolReferences(
    symbols: OxcFileSymbols[], 
    diffFiles: FileDiff[]
  ): Promise<PreprocessedSymbol[]> {
    const preprocessedSymbols: PreprocessedSymbol[] = [];
    
    // Create a map of all symbols for quick lookup
    const allSymbols = new Map<string, { filename: string, symbol: any }>();
    for (const fileSymbols of symbols) {
      for (const symbol of fileSymbols.symbols) {
        allSymbols.set(symbol.name, {
          filename: fileSymbols.filename,
          symbol
        });
      }
    }
    
    // Process each symbol to find its references across all diff files
    for (const [symbolName, symbolData] of allSymbols) {
      const references = this.findSymbolReferencesInDiff(symbolName, symbolData.filename, diffFiles);
      
      // Only include symbols that have references in the PR (used somewhere)
      if (references.length > 0) {
        preprocessedSymbols.push({
          name: symbolName,
          filename: symbolData.filename,
          line: symbolData.symbol.line,
          type: symbolData.symbol.type,
          isExported: symbolData.symbol.isExported,
          className: symbolData.symbol.className,
          references
        });
      }
    }
    
    return preprocessedSymbols;
  }

  /**
   * Find symbol references across diff files (backend implementation)
   */
  private findSymbolReferencesInDiff(
    symbolName: string, 
    definitionFile: string, 
    diffFiles: FileDiff[]
  ): SymbolReference[] {
    const references: SymbolReference[] = [];
    
    for (const file of diffFiles) {
      // Skip the file where the symbol is defined
      if (file.filename === definitionFile) continue;
      
      const language = this.detectLanguageFromFilename(file.filename);
      if (!this.isHighlightableLanguage(language)) continue;
      
      // Search through diff lines for symbol usage
      for (const line of file.lines) {
        if (line.isHunkHeader) continue;
        
        // Use OXC-based precise symbol detection
        const lineNumber = line.type === 'added' ? line.lineNumber : 
                         line.type === 'removed' ? line.oldLineNumber : 
                         line.lineNumber || line.oldLineNumber;
        
        if (this.lineContainsSymbol(line.content, symbolName, file.filename, lineNumber)) {
          
          references.push({
            file: file.filename,
            line: lineNumber || 0,
            type: line.type as any,
            context: this.determineUsageContext(line.content, symbolName),
            content: line.content.trim()
          });
        }
      }
    }
    
    return references;
  }

  /**
   * Detect if a line contains a symbol (simple implementation)
   */
  private lineContainsSymbol(lineContent: string, symbolName: string, filename?: string, lineNumber?: number): boolean {
    // Use precomputed OXC-based symbol references for precise detection
    if (filename && lineNumber && this.symbolReferencesCache.has(filename)) {
      return lineContainsAnySymbol(lineNumber, filename, [symbolName], this.symbolReferencesCache);
    }
    
    // Fallback: if no precomputed data, assume it doesn't contain the symbol
    // This is safe - better to miss a reference than show false positives
    return false;
  }

  /**
   * Determine the usage context of a symbol in a line
   */
  private determineUsageContext(lineContent: string, symbolName: string): string {
    const line = lineContent.trim();
    
    // Function call pattern
    if (line.includes(`${symbolName}(`)) {
      return 'function_call';
    }
    
    // Property access
    if (line.includes(`.${symbolName}`) || line.includes(`${symbolName}.`)) {
      return 'property_access';
    }
    
    // Assignment
    if (line.includes(`= ${symbolName}`) || line.includes(`${symbolName} =`)) {
      return 'assignment';
    }
    
    // Import/export
    if (line.includes('import') && line.includes(symbolName)) {
      return 'import';
    }
    
    if (line.includes('export') && line.includes(symbolName)) {
      return 'export';
    }
    
    return 'reference';
  }

  /**
   * Detect language from filename
   */
  private detectLanguageFromFilename(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'ts':
      case 'tsx':
        return 'typescript';
      case 'js':
      case 'jsx':
        return 'javascript';
      default:
        return 'text';
    }
  }

  /**
   * Check if language supports highlighting
   */
  private isHighlightableLanguage(language: string): boolean {
    return ['typescript', 'javascript'].includes(language);
  }

}