/**
 * Parser for JavaScript/TypeScript import statements
 */

import type { ImportDeclaration, ImportSpecifier } from '../types/analysis';

export class ImportParser {
  private static readonly IMPORT_PATTERNS = [
    // import { a, b } from 'module'
    /^import\s*\{\s*([^}]+)\s*\}\s*from\s*['"`]([^'"`]+)['"`]/,
    // import * as name from 'module'
    /^import\s*\*\s*as\s+(\w+)\s*from\s*['"`]([^'"`]+)['"`]/,
    // import name from 'module'
    /^import\s+(\w+)\s*from\s*['"`]([^'"`]+)['"`]/,
    // import 'module'
    /^import\s*['"`]([^'"`]+)['"`]/,
    // import name, { a, b } from 'module'
    /^import\s+(\w+)\s*,\s*\{\s*([^}]+)\s*\}\s*from\s*['"`]([^'"`]+)['"`]/
  ];

  /**
   * Parses an import statement from a line of code
   */
  parse(line: string, lineNumber: number): ImportDeclaration | null {
    for (const pattern of ImportParser.IMPORT_PATTERNS) {
      const match = line.match(pattern);
      if (match) {
        return this.buildImportDeclaration(match, lineNumber);
      }
    }
    return null;
  }

  private buildImportDeclaration(match: RegExpMatchArray, lineNumber: number): ImportDeclaration {
    if (this.isNamespaceImport(match[0])) {
      return this.buildNamespaceImport(match, lineNumber);
    }
    
    if (this.hasNamedImports(match[0])) {
      return this.buildNamedImport(match, lineNumber);
    }
    
    if (this.isDefaultImport(match)) {
      return this.buildDefaultImport(match, lineNumber);
    }
    
    return this.buildSideEffectImport(match, lineNumber);
  }

  private isNamespaceImport(matchString: string): boolean {
    return matchString.includes('* as');
  }

  private hasNamedImports(matchString: string): boolean {
    return matchString.includes('{');
  }

  private isDefaultImport(match: RegExpMatchArray): boolean {
    return !!(match[1] && match[2]);
  }

  private buildNamespaceImport(match: RegExpMatchArray, lineNumber: number): ImportDeclaration {
    return {
      type: 'import',
      source: match[2] || '',
      imports: [{ name: match[1] || '', isNamespace: true }],
      line: lineNumber
    };
  }

  private buildNamedImport(match: RegExpMatchArray, lineNumber: number): ImportDeclaration {
    const imports: ImportSpecifier[] = [];
    const namedImports = match[1] || match[2];
    const source = match[2] || match[3];
    
    if (namedImports) {
      imports.push(...this.parseNamedImports(namedImports));
    }
    
    // Handle default + named imports pattern
    if (match[1] && match[2]) {
      imports.unshift({ name: match[1], isDefault: true });
    }
    
    return {
      type: 'import',
      source: source || '',
      imports,
      line: lineNumber
    };
  }

  private buildDefaultImport(match: RegExpMatchArray, lineNumber: number): ImportDeclaration {
    return {
      type: 'import',
      source: match[2] || '',
      imports: [{ name: match[1] || '', isDefault: true }],
      line: lineNumber
    };
  }

  private buildSideEffectImport(match: RegExpMatchArray, lineNumber: number): ImportDeclaration {
    return {
      type: 'import',
      source: match[1] || '',
      imports: [],
      line: lineNumber
    };
  }

  private parseNamedImports(namedImportsString: string): ImportSpecifier[] {
    return namedImportsString
      .split(',')
      .map(importString => this.parseImportSpecifier(importString))
      .filter((spec): spec is ImportSpecifier => spec !== null);
  }

  private parseImportSpecifier(importString: string): ImportSpecifier | null {
    const trimmed = importString.trim();
    if (!trimmed) return null;

    const aliasMatch = trimmed.match(/(\w+)\s+as\s+(\w+)/);
    if (aliasMatch) {
      return {
        name: aliasMatch[1],
        alias: aliasMatch[2]
      };
    }

    return { name: trimmed };
  }
}