/**
 * Parser for JavaScript/TypeScript export statements
 */

import type { ExportDeclaration, ExportKind } from '../types/analysis';

export class ExportParser {
  private static readonly EXPORT_PATTERNS = [
    // export default class/function/const
    /^export\s+default\s+(class|function|const|let|var|interface|type|enum)\s+(\w+)/,
    // export class/function/const
    /^export\s+(class|function|const|let|var|interface|type|enum)\s+(\w+)/,
    // export { name }
    /^export\s*\{\s*(\w+)\s*\}/,
    // export default (expression)
    /^export\s+default\s+(\w+)/
  ];

  /**
   * Parses an export statement from a line of code
   */
  parse(line: string, lineNumber: number): ExportDeclaration | null {
    for (const pattern of ExportParser.EXPORT_PATTERNS) {
      const match = line.match(pattern);
      if (match) {
        return this.buildExportDeclaration(match, line, lineNumber);
      }
    }
    return null;
  }

  private buildExportDeclaration(
    match: RegExpMatchArray, 
    line: string, 
    lineNumber: number
  ): ExportDeclaration {
    const isDefault = line.includes('default');
    
    if (match[2]) {
      // Named export with explicit type (class, function, etc.)
      return {
        type: 'export',
        name: match[2],
        kind: match[1] as ExportKind,
        isDefault,
        line: lineNumber
      };
    }
    
    // Export without explicit type or re-export
    return {
      type: 'export',
      name: match[1] || '',
      kind: 'const', // Default to const for unknown types
      isDefault,
      line: lineNumber
    };
  }
}