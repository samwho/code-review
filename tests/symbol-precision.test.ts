import { describe, expect, it } from 'bun:test';
import { lineContainsSymbolPrecise } from '../src/utils/oxc-line-analyzer';

// We need to create a test helper that exposes the private method for testing
class GitServiceTestHelper {
  // Old broken implementation for comparison
  public lineContainsSymbolOld(lineContent: string, symbolName: string): boolean {
    // Skip comments and strings (basic detection)
    if (lineContent.trim().startsWith('//') || lineContent.trim().startsWith('*')) {
      return false;
    }

    // Look for symbol as whole word, not part of another identifier
    const regex = new RegExp(`\\b${symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    return regex.test(lineContent);
  }

  // This is the new optimized version (fast regex with smart string detection)
  public lineContainsSymbol(lineContent: string, symbolName: string): boolean {
    // Fast string-based detection with improved accuracy (no expensive parsing)

    // Skip obvious comments
    const trimmed = lineContent.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      return false;
    }

    // Quick string literal detection - look for symbol inside quotes
    // This handles the most common false positive: "/auth/register"
    const quotedRegex = new RegExp(
      `['"\`][^'"\`]*\\b${symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[^'"\`]*['"\`]`
    );
    if (quotedRegex.test(lineContent)) {
      return false; // Symbol is inside quotes, ignore it
    }

    // Look for symbol as whole word, not part of another identifier
    const regex = new RegExp(`\\b${symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    return regex.test(lineContent);
  }

  // Keep the OXC version for comparison (but don't use in production due to performance)
  public lineContainsSymbolPrecise(lineContent: string, symbolName: string): boolean {
    return lineContainsSymbolPrecise(lineContent, symbolName);
  }
}

describe('Symbol Reference Precision - Current Issues', () => {
  const helper = new GitServiceTestHelper();

  describe('Current lineContainsSymbol (now fixed!)', () => {
    it('should NOT detect symbols inside string literals', () => {
      const testCases = [
        {
          line: '  return fetch("/auth/register", {',
          symbol: 'register',
          shouldFind: false,
          description: 'symbol inside string literal',
        },
        {
          line: '  const url = "api/user/register";',
          symbol: 'register',
          shouldFind: false,
          description: 'symbol inside string literal with quotes',
        },
        {
          line: '  const template = `Hello $' + '{user}, please register at /register`;',
          symbol: 'register',
          shouldFind: false,
          description: 'symbol inside template literal',
        },
        {
          line: "  console.log('register function called');",
          symbol: 'register',
          shouldFind: false,
          description: 'symbol inside single-quoted string',
        },
      ];

      for (const { line, symbol, shouldFind } of testCases) {
        const result = helper.lineContainsSymbol(line, symbol);
        expect(result).toBe(shouldFind);
      }
    });

    it('should NOT detect symbols inside comments', () => {
      const testCases = [
        {
          line: '// Function to register users',
          symbol: 'register',
          shouldFind: false,
        },
        {
          line: '/* register function implementation */',
          symbol: 'register',
          shouldFind: false,
        },
        {
          line: ' * Call register to sign up',
          symbol: 'register',
          shouldFind: false,
        },
      ];

      for (const { line, symbol, shouldFind } of testCases) {
        const result = helper.lineContainsSymbol(line, symbol);
        expect(result).toBe(shouldFind);
      }
    });

    it('should correctly detect actual symbol references', () => {
      const testCases = [
        {
          line: 'register(newUser);',
          symbol: 'register',
          shouldFind: true,
          description: 'function call',
        },
        {
          line: 'const fn = register;',
          symbol: 'register',
          shouldFind: true,
          description: 'variable assignment',
        },
        {
          line: 'export { register };',
          symbol: 'register',
          shouldFind: true,
          description: 'export statement',
        },
        {
          line: 'if (register) {',
          symbol: 'register',
          shouldFind: true,
          description: 'conditional usage',
        },
      ];

      for (const { line, symbol, shouldFind } of testCases) {
        const result = helper.lineContainsSymbol(line, symbol);
        expect(result).toBe(shouldFind);
      }
    });
  });

  describe('OXC-based precise detection (to be implemented)', () => {
    it('should use OXC to precisely detect only real symbol references', () => {
      // This test shows what we want to achieve
      const testCases = [
        // Should NOT find
        { line: '  return fetch("/auth/register", {', symbol: 'register', expected: false },
        { line: '// Function to register users', symbol: 'register', expected: false },
        { line: '  const url = "register";', symbol: 'register', expected: false },

        // Should find
        { line: 'register(newUser);', symbol: 'register', expected: true },
        { line: 'const fn = register;', symbol: 'register', expected: true },
        { line: 'export { register };', symbol: 'register', expected: true },
      ];

      for (const { line, symbol, expected } of testCases) {
        const result = helper.lineContainsSymbolPrecise(line, symbol);
        expect(result).toBe(expected);
      }
    });
  });
});
