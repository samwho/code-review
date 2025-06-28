import { spawn } from 'bun';

export interface DiffLine {
  type: 'added' | 'removed' | 'context';
  content: string;
  lineNumber?: number;
  oldLineNumber?: number;
}

export interface FileDiff {
  filename: string;
  oldFilename?: string;
  lines: DiffLine[];
  isNew: boolean;
  isDeleted: boolean;
}

export class GitService {
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
        const match = line.match(/@@ -(\d+),?\d* \+(\d+),?\d* @@/);
        if (match) {
          oldLineNumber = parseInt(match[1]);
          newLineNumber = parseInt(match[2]);
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
}