import { describe, expect, it } from 'bun:test';
import { extractSymbolReferencesFromContent } from '../src/utils/oxc-symbol-reference-extractor';

describe('Class Method Reference Detection', () => {
  describe('Symbol reference extraction for class methods', () => {
    it('should correctly identify method references vs class references', () => {
      const testFileContent = `
class AuthService {
  constructor() {
    this.apiUrl = '/api';
  }

  async login(credentials: LoginCredentials) {
    return this.post('/auth/login', credentials);
  }

  async register(userData: UserData) {
    return this.post('/auth/register', userData);
  }

  private post(url: string, data: any) {
    return fetch(this.apiUrl + url, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }
}

// Usage elsewhere in the file
const authService = new AuthService();
authService.login(userCreds);
authService.register(newUser);
`;

      // Test symbol names we're looking for
      const symbolNames = new Set(['AuthService', 'login', 'register', 'post']);

      const references = extractSymbolReferencesFromContent(
        testFileContent,
        'auth-service.ts',
        symbolNames
      );

      // Group references by symbol name for easier testing
      const refsBySymbol = new Map<
        string,
        Array<{
          name: string;
          line: number;
          context: string;
        }>
      >();
      for (const ref of references) {
        if (!refsBySymbol.has(ref.name)) {
          refsBySymbol.set(ref.name, []);
        }
        refsBySymbol.get(ref.name)?.push(ref);
      }

      // Test AuthService class references
      const authServiceRefs = refsBySymbol.get('AuthService') || [];
      // Debug: AuthService references

      // Should find:
      // 1. new AuthService() - constructor call (line will vary based on content)
      // Should NOT find the class definition itself (that's a definition, not a reference)
      expect(authServiceRefs.length).toBe(1);
      expect(authServiceRefs[0].line).toBeGreaterThan(20); // Should be in the usage section
      expect(authServiceRefs[0].context).toBe('identifier'); // In 'new AuthService()'

      // Test login method references
      const loginRefs = refsBySymbol.get('login') || [];
      // Debug: login references

      // Should find:
      // 1. authService.login(userCreds) - method call
      // Should NOT find the method definition
      expect(loginRefs.length).toBe(1);
      expect(loginRefs[0].line).toBeGreaterThan(20); // Should be in usage section
      expect(loginRefs[0].context).toBe('property_access');

      // Test register method references
      const registerRefs = refsBySymbol.get('register') || [];
      // Debug: register references

      // Should find:
      // 1. authService.register(newUser) - method call
      // Should NOT find the method definition
      // Should NOT find "/auth/register" in the string literal
      expect(registerRefs.length).toBe(1);
      expect(registerRefs[0].line).toBeGreaterThan(20); // Should be in usage section
      expect(registerRefs[0].context).toBe('property_access');

      // Test private method references
      const postRefs = refsBySymbol.get('post') || [];
      // Debug: post references

      // Should find:
      // 1. this.post('/auth/login', credentials)
      // 2. this.post('/auth/register', userData)
      // Should NOT find the method definition
      expect(postRefs.length).toBe(2);
      for (const ref of postRefs) {
        expect(ref.line).toBeGreaterThan(5); // Should be in method bodies
        expect(ref.line).toBeLessThan(20); // But before usage section
        expect(ref.context).toBe('property_access');
      }
    });

    it('should not confuse class name with method names in symbol preprocessing', () => {
      // This test checks the specific bug where class method references
      // incorrectly show the class definition instead of method references

      const usageContent = `
import { UserService } from './user-service';

const userService = new UserService();
const user = userService.findUser('123');
`;

      // Extract references from the usage file
      const symbolNames = new Set(['UserService', 'findUser']);

      const references = extractSymbolReferencesFromContent(
        usageContent,
        'user-controller.ts',
        symbolNames
      );

      // Group by symbol
      const refsBySymbol = new Map<
        string,
        Array<{
          name: string;
          line: number;
          context: string;
        }>
      >();
      for (const ref of references) {
        if (!refsBySymbol.has(ref.name)) {
          refsBySymbol.set(ref.name, []);
        }
        refsBySymbol.get(ref.name)?.push(ref);
      }

      // Debug: UserService references in usage file
      // Debug: findUser references in usage file

      // UserService should appear in import and constructor
      const userServiceRefs = refsBySymbol.get('UserService') || [];
      expect(userServiceRefs.length).toBeGreaterThan(0);

      // findUser should appear in method call, not confused with UserService
      const findUserRefs = refsBySymbol.get('findUser') || [];
      expect(findUserRefs.length).toBe(1);
      expect(findUserRefs[0].line).toBeGreaterThan(3); // Should be in usage section
      expect(findUserRefs[0].context).toBe('property_access');

      // Most importantly: findUser reference should NOT point to UserService class definition
      // This is the bug we're trying to catch
      for (const ref of findUserRefs) {
        expect(ref.name).toBe('findUser'); // Should be 'findUser', not 'UserService'
      }
    });
  });
});
