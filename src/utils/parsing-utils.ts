/**
 * Parsing utilities for code analysis and syntax parsing
 */

import { APP_CONFIG } from '../config';

/**
 * Token type for code tokenization
 */
export interface Token {
  value: string;
  column: number;
  type: 'identifier' | 'operator' | 'string' | 'comment';
}

/**
 * Tokenizes a line of code into analyzable tokens
 */
export function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  
  while (i < line.length) {
    const char = line[i];
    
    // Skip whitespace
    if (/\s/.test(char)) {
      i++;
      continue;
    }
    
    // Skip strings and comments
    if (char === '"' || char === "'" || char === '`') {
      const quote = char;
      const start = i;
      i++;
      while (i < line.length && line[i] !== quote) {
        if (line[i] === '\\') i++; // Skip escaped characters
        i++;
      }
      i++;
      tokens.push({
        value: line.slice(start, i),
        column: start,
        type: 'string'
      });
      continue;
    }
    
    if (char === '/' && line[i + 1] === '/') {
      tokens.push({
        value: line.slice(i),
        column: i,
        type: 'comment'
      });
      break; // Rest of line is comment
    }
    
    // Identifiers
    if (/[a-zA-Z_$]/.test(char)) {
      const start = i;
      while (i < line.length && /[a-zA-Z0-9_$]/.test(line[i])) {
        i++;
      }
      tokens.push({
        value: line.slice(start, i),
        column: start,
        type: 'identifier'
      });
      continue;
    }
    
    // Other characters (operators, punctuation)
    tokens.push({
      value: char,
      column: i,
      type: 'operator'
    });
    i++;
  }
  
  return tokens;
}

/**
 * Checks if a token is a valid identifier
 */
export function isValidIdentifier(token: string): boolean {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(token) && 
         !APP_CONFIG.TYPESCRIPT_KEYWORDS.has(token);
}

/**
 * Parses function parameters from a parameter string
 */
export function parseFunctionParameters(paramString: string): string[] {
  if (!paramString.trim()) return [];
  
  return paramString
    .split(',')
    .map(param => param.trim().split(':')[0].trim()) // Remove type annotations
    .filter(param => param.length > 0);
}

/**
 * Determines the context of a symbol based on surrounding tokens
 */
export function determineSymbolContext(
  tokens: Token[], 
  symbolIndex: number
): 'declaration' | 'assignment' | 'usage' {
  const prevToken = tokens[symbolIndex - 1];
  const nextToken = tokens[symbolIndex + 1];
  
  // Check for declarations
  if (prevToken && ['const', 'let', 'var', 'function', 'class', 'interface', 'type', 'enum'].includes(prevToken.value)) {
    return 'declaration';
  }
  
  // Check for assignments
  if (nextToken && nextToken.value === '=') {
    return 'assignment';
  }
  
  return 'usage';
}

/**
 * Finds the end line of a function by counting braces
 */
export function findFunctionEndLine(lines: string[], startLine: number): number {
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