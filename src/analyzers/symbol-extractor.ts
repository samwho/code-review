/**
 * Extracts and categorizes symbols from JavaScript/TypeScript code
 */

import type { SymbolReference, SymbolContext, Token } from '../types/analysis';

export class SymbolExtractor {
  private readonly keywords: Set<string>;

  constructor(keywords: Set<string>) {
    this.keywords = keywords;
  }

  /**
   * Extracts symbol references from a line of code
   */
  extractSymbols(line: string, lineNumber: number): SymbolReference[] {
    const symbols: SymbolReference[] = [];
    const tokens = this.tokenizeLine(line);
    
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      
      if (this.isValidSymbol(token)) {
        const context = this.determineSymbolContext(tokens, i);
        symbols.push({
          name: token.value,
          line: lineNumber,
          column: token.column,
          context
        });
      }
    }
    
    return symbols;
  }

  private tokenizeLine(line: string): Token[] {
    const tokens: Token[] = [];
    let position = 0;
    
    while (position < line.length) {
      const char = line[position];
      
      if (this.isWhitespace(char)) {
        position++;
        continue;
      }
      
      if (this.isQuote(char)) {
        position = this.skipString(line, position);
        continue;
      }
      
      if (this.isComment(line, position)) {
        break; // Rest of line is comment
      }
      
      if (this.isIdentifierStart(char)) {
        const identifier = this.extractIdentifier(line, position);
        tokens.push(identifier);
        position = identifier.column + identifier.value.length;
        continue;
      }
      
      // Other characters (operators, punctuation)
      tokens.push({
        value: char,
        column: position,
        type: 'operator'
      });
      position++;
    }
    
    return tokens;
  }

  private isWhitespace(char: string): boolean {
    return /\s/.test(char);
  }

  private isQuote(char: string): boolean {
    return char === '"' || char === "'" || char === '`';
  }

  private isComment(line: string, position: number): boolean {
    return line[position] === '/' && line[position + 1] === '/';
  }

  private isIdentifierStart(char: string): boolean {
    return /[a-zA-Z_$]/.test(char);
  }

  private isIdentifierChar(char: string): boolean {
    return /[a-zA-Z0-9_$]/.test(char);
  }

  private skipString(line: string, startPosition: number): number {
    const quote = line[startPosition];
    let position = startPosition + 1;
    
    while (position < line.length && line[position] !== quote) {
      if (line[position] === '\\') {
        position++; // Skip escaped character
      }
      position++;
    }
    
    return position + 1; // Skip closing quote
  }

  private extractIdentifier(line: string, startPosition: number): Token {
    let position = startPosition;
    
    while (position < line.length && this.isIdentifierChar(line[position])) {
      position++;
    }
    
    return {
      value: line.slice(startPosition, position),
      column: startPosition,
      type: 'identifier'
    };
  }

  private isValidSymbol(token: Token): boolean {
    return token.type === 'identifier' && 
           !this.keywords.has(token.value) &&
           /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(token.value);
  }

  private determineSymbolContext(tokens: Token[], currentIndex: number): SymbolContext {
    const prevToken = tokens[currentIndex - 1];
    const nextToken = tokens[currentIndex + 1];
    
    if (this.isDeclarationKeyword(prevToken)) {
      return 'declaration';
    }
    
    if (this.isAssignmentOperator(nextToken)) {
      return 'assignment';
    }
    
    return 'usage';
  }

  private isDeclarationKeyword(token: Token | undefined): boolean {
    if (!token) return false;
    
    const declarationKeywords = [
      'const', 'let', 'var', 'function', 'class', 
      'interface', 'type', 'enum'
    ];
    
    return declarationKeywords.includes(token.value);
  }

  private isAssignmentOperator(token: Token | undefined): boolean {
    return token?.value === '=';
  }
}