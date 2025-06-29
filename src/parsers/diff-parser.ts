/**
 * Parser for Git diff output
 */

import type { FileDiff } from '../types/git';

export class DiffParser {
  /**
   * Parses git diff output into structured FileDiff objects
   */
  parse(diffOutput: string): FileDiff[] {
    const files: FileDiff[] = [];
    const lines = diffOutput.split('\n');
    let currentFile: FileDiff | null = null;
    const lineContext = new LineContext();

    for (const line of lines) {
      if (this.isFileDiffHeader(line)) {
        if (currentFile) {
          files.push(currentFile);
        }
        currentFile = this.createFileDiff(line);
      } else if (currentFile) {
        this.processLine(line, currentFile, lineContext);
      }
    }

    if (currentFile) {
      files.push(currentFile);
    }

    return files;
  }

  private isFileDiffHeader(line: string): boolean {
    return line.startsWith('diff --git');
  }

  private createFileDiff(headerLine: string): FileDiff | null {
    const match = headerLine.match(/diff --git a\/(.+) b\/(.+)/);
    if (!match) return null;

    return {
      filename: match[2],
      oldFilename: match[1] !== match[2] ? match[1] : undefined,
      lines: [],
      isNew: false,
      isDeleted: false,
    };
  }

  private processLine(line: string, file: FileDiff, context: LineContext): void {
    if (line.startsWith('new file mode')) {
      file.isNew = true;
    } else if (line.startsWith('deleted file mode')) {
      file.isDeleted = true;
    } else if (line.startsWith('@@')) {
      this.processHunkHeader(line, file, context);
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      this.processAddedLine(line, file, context);
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      this.processRemovedLine(line, file, context);
    } else if (line.startsWith(' ')) {
      this.processContextLine(line, file, context);
    }
  }

  private processHunkHeader(line: string, file: FileDiff, context: LineContext): void {
    const match = line.match(/@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@(.*)/);
    if (match) {
      context.oldLineNumber = Number.parseInt(match[1]);
      context.newLineNumber = Number.parseInt(match[3]);

      file.lines.push({
        type: 'context',
        content: line,
        lineNumber: undefined,
        oldLineNumber: undefined,
        isHunkHeader: true,
      });
    }
  }

  private processAddedLine(line: string, file: FileDiff, context: LineContext): void {
    file.lines.push({
      type: 'added',
      content: line.substring(1),
      lineNumber: context.newLineNumber,
    });
    context.newLineNumber++;
  }

  private processRemovedLine(line: string, file: FileDiff, context: LineContext): void {
    file.lines.push({
      type: 'removed',
      content: line.substring(1),
      oldLineNumber: context.oldLineNumber,
    });
    context.oldLineNumber++;
  }

  private processContextLine(line: string, file: FileDiff, context: LineContext): void {
    file.lines.push({
      type: 'context',
      content: line.substring(1),
      lineNumber: context.newLineNumber,
      oldLineNumber: context.oldLineNumber,
    });
    context.oldLineNumber++;
    context.newLineNumber++;
  }
}

/**
 * Tracks line numbers while parsing diff
 */
class LineContext {
  oldLineNumber = 0;
  newLineNumber = 0;
}
