import { spawn } from 'bun';
import { DependencyAnalyzer, type DependencyGraph } from './dependency-analyzer';

export interface DiffLine {
  type: 'added' | 'removed' | 'context';
  content: string;
  lineNumber?: number;
  oldLineNumber?: number;
  isHunkHeader?: boolean;
}

export interface FileDiff {
  filename: string;
  oldFilename?: string;
  lines: DiffLine[];
  isNew: boolean;
  isDeleted: boolean;
}

export class GitService {
  private analyzer = new DependencyAnalyzer();
  
  constructor(private repoPath: string = './test-repo') {}

  async getDiff(baseBranch: string, compareBranch: string): Promise<FileDiff[]> {
    const proc = spawn(['git', 'diff', '--no-color', '--unified=3', `${baseBranch}...${compareBranch}`], {
      cwd: this.repoPath,
      stdout: 'pipe',
      stderr: 'pipe'
    });

    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    
    if (exitCode !== 0) {
      throw new Error(`Git diff failed with exit code ${exitCode}`);
    }

    return this.parseDiff(output);
  }

  private parseDiff(diffOutput: string): FileDiff[] {
    const files: FileDiff[] = [];
    const lines = diffOutput.split('\n');
    let currentFile: FileDiff | null = null;
    let oldLineNumber = 0;
    let newLineNumber = 0;

    for (const line of lines) {
      if (line.startsWith('diff --git')) {
        if (currentFile) {
          files.push(currentFile);
        }
        const match = line.match(/diff --git a\/(.+) b\/(.+)/);
        if (match) {
          currentFile = {
            filename: match[2],
            oldFilename: match[1] !== match[2] ? match[1] : undefined,
            lines: [],
            isNew: false,
            isDeleted: false
          };
        }
      } else if (line.startsWith('new file mode')) {
        if (currentFile) {
          currentFile.isNew = true;
        }
      } else if (line.startsWith('deleted file mode')) {
        if (currentFile) {
          currentFile.isDeleted = true;
        }
      } else if (line.startsWith('@@')) {
        const match = line.match(/@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@(.*)/);
        if (match) {
          oldLineNumber = parseInt(match[1]);
          newLineNumber = parseInt(match[3]);
          
          // Add hunk header as a special line type
          if (currentFile) {
            currentFile.lines.push({
              type: 'context',
              content: line,
              lineNumber: undefined,
              oldLineNumber: undefined,
              isHunkHeader: true
            });
          }
        }
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        if (currentFile) {
          currentFile.lines.push({
            type: 'added',
            content: line.substring(1),
            lineNumber: newLineNumber
          });
          newLineNumber++;
        }
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        if (currentFile) {
          currentFile.lines.push({
            type: 'removed',
            content: line.substring(1),
            oldLineNumber: oldLineNumber
          });
          oldLineNumber++;
        }
      } else if (line.startsWith(' ')) {
        if (currentFile) {
          currentFile.lines.push({
            type: 'context',
            content: line.substring(1),
            lineNumber: newLineNumber,
            oldLineNumber: oldLineNumber
          });
          oldLineNumber++;
          newLineNumber++;
        }
      }
    }

    if (currentFile) {
      files.push(currentFile);
    }

    return files;
  }

  async getBranches(): Promise<string[]> {
    const proc = spawn(['git', 'branch', '--format=%(refname:short)'], {
      cwd: this.repoPath,
      stdout: 'pipe',
      stderr: 'pipe'
    });

    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    
    if (exitCode !== 0) {
      throw new Error(`Git branch list failed with exit code ${exitCode}`);
    }

    return output.trim().split('\n').filter(branch => branch.trim());
  }

  async getFileContents(branch: string, filePath: string): Promise<string> {
    const proc = spawn(['git', 'show', `${branch}:${filePath}`], {
      cwd: this.repoPath,
      stdout: 'pipe',
      stderr: 'pipe'
    });

    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    
    if (exitCode !== 0) {
      throw new Error(`Failed to get file contents for ${filePath} in ${branch}`);
    }

    return output;
  }

  async getFilesInBranch(branch: string): Promise<string[]> {
    const proc = spawn(['git', 'ls-tree', '-r', '--name-only', branch], {
      cwd: this.repoPath,
      stdout: 'pipe',
      stderr: 'pipe'
    });

    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    
    if (exitCode !== 0) {
      throw new Error(`Failed to list files in branch ${branch}`);
    }

    return output.trim().split('\n').filter(file => 
      file.trim() && (file.endsWith('.ts') || file.endsWith('.js') || file.endsWith('.tsx') || file.endsWith('.jsx'))
    );
  }

  async analyzeDependencies(branch: string): Promise<DependencyGraph> {
    const files = await this.getFilesInBranch(branch);
    const fileContents = new Map<string, string>();

    // Get contents for all TypeScript/JavaScript files
    for (const file of files) {
      try {
        const content = await this.getFileContents(branch, file);
        fileContents.set(file, content);
      } catch (error) {
        console.warn(`Could not read file ${file}:`, error);
      }
    }

    return this.analyzer.buildDependencyGraph(fileContents);
  }

  analyzeModifiedFunctions(files: FileDiff[], graph: DependencyGraph): Map<string, FunctionDefinition[]> {
    const modifiedFunctions = new Map<string, FunctionDefinition[]>();
    
    for (const file of files) {
      const fileAnalysis = graph.nodes.get(file.filename);
      if (!fileAnalysis || !fileAnalysis.functions) {
        continue;
      }
      
      const modifiedInFile: FunctionDefinition[] = [];
      
      // Check which functions have changes in their line ranges
      for (const func of fileAnalysis.functions) {
        const hasChanges = file.lines.some(line => {
          if (line.type === 'context' || line.isHunkHeader) return false;
          
          // Check if this change line falls within the function's range
          const changeLineNumber = line.type === 'added' ? line.lineNumber : line.oldLineNumber;
          return changeLineNumber && changeLineNumber >= func.startLine && changeLineNumber <= func.endLine;
        });
        
        if (hasChanges) {
          modifiedInFile.push(func);
        }
      }
      
      if (modifiedInFile.length > 0) {
        modifiedFunctions.set(file.filename, modifiedInFile);
      }
    }
    
    return modifiedFunctions;
  }

  async getOrderedFiles(baseBranch: string, compareBranch: string, orderType: 'top-down' | 'bottom-up' | 'alphabetical' = 'alphabetical'): Promise<{files: FileDiff[], graph?: any}> {
    const diff = await this.getDiff(baseBranch, compareBranch);
    
    if (orderType === 'alphabetical') {
      return { files: diff.sort((a, b) => a.filename.localeCompare(b.filename)) };
    }

    // For dependency-based ordering, analyze the compare branch
    try {
      const graph = await this.analyzeDependencies(compareBranch);
      const orderedFilenames = this.analyzer.topologicalSort(graph, orderType === 'top-down');
      
      // Sort diff files based on dependency order
      const fileOrder = new Map(orderedFilenames.map((file, index) => [file, index]));
      
      const sortedFiles = diff.sort((a, b) => {
        const orderA = fileOrder.get(a.filename) ?? 999999;
        const orderB = fileOrder.get(b.filename) ?? 999999;
        return orderA - orderB;
      });

      // Analyze which functions were modified
      const modifiedFunctions = this.analyzeModifiedFunctions(sortedFiles, graph);
      
      // Convert graph to serializable format for client
      const serializedGraph = {
        nodes: Array.from(graph.nodes.entries()).map(([filename, analysis]) => ({
          filename,
          ...analysis
        })),
        edges: graph.edges,
        modifiedFunctions: Array.from(modifiedFunctions.entries()).map(([filename, functions]) => ({
          filename,
          functions
        }))
      };
      
      return { files: sortedFiles, graph: serializedGraph };
    } catch (error) {
      console.warn('Failed to analyze dependencies, falling back to alphabetical order:', error);
      return { files: diff.sort((a, b) => a.filename.localeCompare(b.filename)) };
    }
  }
}