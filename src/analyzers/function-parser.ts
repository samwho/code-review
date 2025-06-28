/**
 * Parser for JavaScript/TypeScript function definitions
 */

import type { FunctionDefinition } from '../types/analysis';

export class FunctionParser {
  private static readonly FUNCTION_PATTERNS = [
    // Regular function: function name() { ... }
    /^(export\s+)?(async\s+)?function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\((.*?)\)/,
    // Arrow function: const name = (...) => { ... }
    /^(export\s+)?const\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(async\s+)?\((.*?)\)\s*=>/,
    // Method in class: methodName(...) { ... }
    /^\s*(public|private|protected)?\s*(static\s+)?(async\s+)?([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\((.*?)\)\s*[\{\:]/,
    // Object method: name(...) { ... }
    /^\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\((.*?)\)\s*\{/
  ];

  /**
   * Extracts all function definitions from the given content
   */
  extractFunctions(content: string): FunctionDefinition[] {
    const functions: FunctionDefinition[] = [];
    const lines = content.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const functionDef = this.parseFunctionFromLine(lines, i);
      if (functionDef) {
        functions.push(functionDef);
      }
    }
    
    return functions;
  }

  private parseFunctionFromLine(lines: string[], lineIndex: number): FunctionDefinition | null {
    const line = lines[lineIndex];
    const trimmedLine = line.trim();
    
    if (this.shouldSkipLine(trimmedLine)) {
      return null;
    }
    
    for (const pattern of FunctionParser.FUNCTION_PATTERNS) {
      const match = trimmedLine.match(pattern);
      if (match) {
        return this.buildFunctionDefinition(match, pattern, lines, lineIndex);
      }
    }
    
    return null;
  }

  private shouldSkipLine(line: string): boolean {
    return !line || line.startsWith('//') || line.startsWith('/*');
  }

  private buildFunctionDefinition(
    match: RegExpMatchArray,
    pattern: RegExp,
    lines: string[],
    lineIndex: number
  ): FunctionDefinition {
    const patternSource = pattern.source;
    
    if (patternSource.includes('function\\s+')) {
      return this.buildRegularFunction(match, lines, lineIndex);
    }
    
    if (patternSource.includes('const\\s+')) {
      return this.buildArrowFunction(match, lines, lineIndex);
    }
    
    if (patternSource.includes('public|private|protected')) {
      return this.buildClassMethod(match, lines, lineIndex);
    }
    
    return this.buildObjectMethod(match, lines, lineIndex);
  }

  private buildRegularFunction(
    match: RegExpMatchArray, 
    lines: string[], 
    lineIndex: number
  ): FunctionDefinition {
    return {
      name: match[3],
      startLine: lineIndex + 1,
      endLine: this.findFunctionEnd(lines, lineIndex) + 1,
      isExported: !!match[1],
      isAsync: !!match[2],
      parameters: this.parseParameters(match[4])
    };
  }

  private buildArrowFunction(
    match: RegExpMatchArray, 
    lines: string[], 
    lineIndex: number
  ): FunctionDefinition {
    return {
      name: match[2],
      startLine: lineIndex + 1,
      endLine: this.findFunctionEnd(lines, lineIndex) + 1,
      isExported: !!match[1],
      isAsync: !!match[3],
      parameters: this.parseParameters(match[4])
    };
  }

  private buildClassMethod(
    match: RegExpMatchArray, 
    lines: string[], 
    lineIndex: number
  ): FunctionDefinition {
    return {
      name: match[4],
      startLine: lineIndex + 1,
      endLine: this.findFunctionEnd(lines, lineIndex) + 1,
      isExported: false, // Class methods are exported with the class
      isAsync: !!match[3],
      parameters: this.parseParameters(match[5])
    };
  }

  private buildObjectMethod(
    match: RegExpMatchArray, 
    lines: string[], 
    lineIndex: number
  ): FunctionDefinition {
    return {
      name: match[1],
      startLine: lineIndex + 1,
      endLine: this.findFunctionEnd(lines, lineIndex) + 1,
      isExported: false,
      isAsync: false,
      parameters: this.parseParameters(match[2])
    };
  }

  private parseParameters(paramString: string): string[] {
    if (!paramString.trim()) return [];
    
    return paramString
      .split(',')
      .map(param => {
        // Remove type annotations and default values
        const cleanParam = param.trim().split(/[:=]/)[0].trim();
        // Remove destructuring patterns
        const match = cleanParam.match(/^(?:\{[^}]*\}|\[[^\]]*\]|([^{}\[\]]+))$/);
        return match ? (match[1] || cleanParam).trim() : cleanParam;
      })
      .filter(param => param.length > 0);
  }

  private findFunctionEnd(lines: string[], startLine: number): number {
    let braceCount = 0;
    let inFunction = false;
    
    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i];
      
      for (const char of line) {
        if (char === '{') {
          braceCount++;
          inFunction = true;
        } else if (char === '}') {
          braceCount--;
          if (inFunction && braceCount === 0) {
            return i;
          }
        }
      }
    }
    
    // If we can't find the end, assume it goes to the end of the file
    return lines.length - 1;
  }
}