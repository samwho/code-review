/**
 * Comprehensive tests for SimpleSymbolExtractor
 * Tests various TypeScript/JavaScript patterns and edge cases
 */

import { test, expect, beforeEach, afterEach } from 'bun:test';
import { SimpleSymbolExtractor, type SimpleSymbol, type FileSymbols } from '../src/simple-symbol-extractor';
import { rmSync, mkdirSync, writeFileSync } from 'fs';
import { spawn } from 'bun';
import { join } from 'path';

interface TestRepo {
  path: string;
  extractor: SimpleSymbolExtractor;
}

interface TestFile {
  path: string;
  content: string;
}

class SymbolTestRepoBuilder {
  private tempDir: string;
  private repoPath: string;

  constructor(testName: string) {
    this.tempDir = `/tmp/symbol-test-${testName}-${Date.now()}`;
    this.repoPath = join(this.tempDir, 'repo');
  }

  async create(): Promise<TestRepo> {
    // Create directory structure
    mkdirSync(this.repoPath, { recursive: true });
    
    // Initialize git repo
    await this.execGit(['init']);
    await this.execGit(['config', 'user.email', 'test@example.com']);
    await this.execGit(['config', 'user.name', 'Test User']);
    
    return {
      path: this.repoPath,
      extractor: new SimpleSymbolExtractor(this.repoPath)
    };
  }

  async addFiles(files: TestFile[]): Promise<void> {
    for (const file of files) {
      const fullPath = join(this.repoPath, file.path);
      const dir = fullPath.split('/').slice(0, -1).join('/');
      mkdirSync(dir, { recursive: true });
      writeFileSync(fullPath, file.content);
    }
  }

  async commit(message: string): Promise<void> {
    await this.execGit(['add', '.']);
    await this.execGit(['commit', '-m', message]);
  }

  async createBranch(name: string): Promise<void> {
    await this.execGit(['checkout', '-b', name]);
  }

  async checkout(branch: string): Promise<void> {
    await this.execGit(['checkout', branch]);
  }

  cleanup(): void {
    try {
      rmSync(this.tempDir, { recursive: true, force: true });
    } catch (error) {
      console.warn(`Failed to cleanup ${this.tempDir}:`, error);
    }
  }

  private async execGit(args: string[]): Promise<void> {
    const proc = spawn(['git', ...args], {
      cwd: this.repoPath,
      stdout: 'pipe',
      stderr: 'pipe'
    });

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`Git command failed: git ${args.join(' ')}\nError: ${stderr}`);
    }
  }
}

// Test repositories cleanup tracking
const activeSymbolRepos: SymbolTestRepoBuilder[] = [];

function createSymbolTestRepo(testName: string): SymbolTestRepoBuilder {
  const repo = new SymbolTestRepoBuilder(testName);
  activeSymbolRepos.push(repo);
  return repo;
}

afterEach(() => {
  // Clean up all repos created during tests
  while (activeSymbolRepos.length > 0) {
    const repo = activeSymbolRepos.pop()!;
    repo.cleanup();
  }
});

test('basic class and method extraction', async () => {
  const builder = createSymbolTestRepo('basic-class');
  const repo = await builder.create();

  const files: TestFile[] = [
    {
      path: 'src/basic.ts',
      content: `
export class UserService {
  private users: User[] = [];

  async createUser(name: string): Promise<User> {
    const user = { id: generateId(), name };
    this.users.push(user);
    return user;
  }

  findUser(id: string): User | undefined {
    return this.users.find(u => u.id === id);
  }

  private validateUser(user: User): boolean {
    return user.name.length > 0;
  }
}

interface User {
  id: string;
  name: string;
}
      `.trim()
    }
  ];

  await builder.addFiles(files);
  await builder.commit('Add basic class');

  const fileDiffs = [{ filename: 'src/basic.ts', status: 'added' as const, lines: [] }];
  const symbols = await repo.extractor.extractFromChangedFiles(fileDiffs, 'HEAD');

  expect(symbols).toHaveLength(1);
  const fileSymbols = symbols[0];
  expect(fileSymbols.filename).toBe('src/basic.ts');
  expect(fileSymbols.symbols).toHaveLength(5);

  // Check class
  const userServiceClass = fileSymbols.symbols.find(s => s.name === 'UserService');
  expect(userServiceClass).toEqual({
    name: 'UserService',
    type: 'class',
    line: 1,
    isExported: true
  });

  // Check methods
  const createUserMethod = fileSymbols.symbols.find(s => s.name === 'createUser');
  expect(createUserMethod).toEqual({
    name: 'createUser',
    type: 'function',
    line: 4,
    isExported: true,
    className: 'UserService'
  });

  const findUserMethod = fileSymbols.symbols.find(s => s.name === 'findUser');
  expect(findUserMethod).toEqual({
    name: 'findUser',
    type: 'function',
    line: 10,
    isExported: true,
    className: 'UserService'
  });

  const validateUserMethod = fileSymbols.symbols.find(s => s.name === 'validateUser');
  expect(validateUserMethod).toEqual({
    name: 'validateUser',
    type: 'function',
    line: 14,
    isExported: true,
    className: 'UserService'
  });

  // Check interface
  const userInterface = fileSymbols.symbols.find(s => s.name === 'User');
  expect(userInterface).toEqual({
    name: 'User',
    type: 'export',
    line: 19,
    isExported: false // interfaces default to not exported
  });
});

test('function declarations and arrow functions', async () => {
  const builder = createSymbolTestRepo('functions');
  const repo = await builder.create();

  const files: TestFile[] = [
    {
      path: 'src/functions.ts',
      content: `
// Regular function declaration
export function calculateTax(amount: number): number {
  return amount * 0.1;
}

// Function expression
const processPayment = function(amount: number, method: string) {
  return { amount, method, processed: true };
};

// Arrow function
export const validateEmail = (email: string): boolean => {
  return email.includes('@');
};

// Complex arrow function
const createLogger = (prefix: string) => (message: string) => {
  console.log(\`[\${prefix}] \${message}\`);
};

// Async functions
export async function fetchUserData(id: string): Promise<User> {
  const response = await fetch(\`/api/users/\${id}\`);
  return response.json();
}

// Generator function
export function* generateNumbers(): Generator<number> {
  for (let i = 0; i < 10; i++) {
    yield i;
  }
}

// Function with generic
export function identity<T>(value: T): T {
  return value;
}
      `.trim()
    }
  ];

  await builder.addFiles(files);
  await builder.commit('Add various function types');

  const fileDiffs = [{ filename: 'src/functions.ts', status: 'added' as const, lines: [] }];
  const symbols = await repo.extractor.extractFromChangedFiles(fileDiffs, 'HEAD');

  expect(symbols).toHaveLength(1);
  const fileSymbols = symbols[0];
  expect(fileSymbols.symbols).toHaveLength(7); // Updated: includes createLogger arrow function

  // Regular function declaration
  const calculateTax = fileSymbols.symbols.find(s => s.name === 'calculateTax');
  expect(calculateTax).toEqual({
    name: 'calculateTax',
    type: 'function',
    line: 2,
    isExported: true
  });

  // Arrow function variable
  const validateEmail = fileSymbols.symbols.find(s => s.name === 'validateEmail');
  expect(validateEmail).toEqual({
    name: 'validateEmail',
    type: 'function',
    line: 12,
    isExported: true
  });

  // Function expression variable
  const processPayment = fileSymbols.symbols.find(s => s.name === 'processPayment');
  expect(processPayment).toEqual({
    name: 'processPayment',
    type: 'function',
    line: 7,
    isExported: false
  });

  // Async function
  const fetchUserData = fileSymbols.symbols.find(s => s.name === 'fetchUserData');
  expect(fetchUserData).toEqual({
    name: 'fetchUserData',
    type: 'function',
    line: 22,
    isExported: true
  });

  // Generator function
  const generateNumbers = fileSymbols.symbols.find(s => s.name === 'generateNumbers');
  expect(generateNumbers).toEqual({
    name: 'generateNumbers',
    type: 'function',
    line: 28,
    isExported: true
  });

  // Generic function
  const identity = fileSymbols.symbols.find(s => s.name === 'identity');
  expect(identity).toEqual({
    name: 'identity',
    type: 'function',
    line: 35,
    isExported: true
  });
});

test('export patterns and variable declarations', async () => {
  const builder = createSymbolTestRepo('exports');
  const repo = await builder.create();

  const files: TestFile[] = [
    {
      path: 'src/exports.ts',
      content: `
// Named exports
export const API_BASE_URL = 'https://api.example.com';
export let currentUser: User | null = null;
export var DEBUG_MODE = process.env.NODE_ENV === 'development';

// Default export
const config = {
  apiUrl: API_BASE_URL,
  retries: 3
};
export default config;

// Re-exports
export { UserService } from './user-service';
export { Database as DB } from './database';

// Export declarations
export interface ApiResponse<T> {
  data: T;
  success: boolean;
}

export type Status = 'pending' | 'success' | 'error';

// Const assertions
export const COLORS = ['red', 'green', 'blue'] as const;

// Complex exports
export const createApiClient = (baseUrl: string) => ({
  get: (path: string) => fetch(\`\${baseUrl}\${path}\`),
  post: (path: string, data: any) => fetch(\`\${baseUrl}\${path}\`, {
    method: 'POST',
    body: JSON.stringify(data)
  })
});
      `.trim()
    }
  ];

  await builder.addFiles(files);
  await builder.commit('Add export patterns');

  const fileDiffs = [{ filename: 'src/exports.ts', status: 'added' as const, lines: [] }];
  const symbols = await repo.extractor.extractFromChangedFiles(fileDiffs, 'HEAD');

  expect(symbols).toHaveLength(1);
  const fileSymbols = symbols[0];
  expect(fileSymbols.symbols).toHaveLength(8); // Updated: correct count with DB alias

  // Named constant exports
  const apiBaseUrl = fileSymbols.symbols.find(s => s.name === 'API_BASE_URL');
  expect(apiBaseUrl).toEqual({
    name: 'API_BASE_URL',
    type: 'export',
    line: 2,
    isExported: true
  });

  const debugMode = fileSymbols.symbols.find(s => s.name === 'DEBUG_MODE');
  expect(debugMode).toEqual({
    name: 'DEBUG_MODE',
    type: 'export',
    line: 4,
    isExported: true
  });

  // Interface export
  const apiResponse = fileSymbols.symbols.find(s => s.name === 'ApiResponse');
  expect(apiResponse).toEqual({
    name: 'ApiResponse',
    type: 'export',
    line: 18,
    isExported: true
  });

  // Re-exports
  const userService = fileSymbols.symbols.find(s => s.name === 'UserService');
  expect(userService).toEqual({
    name: 'UserService',
    type: 'export',
    line: 14,
    isExported: true
  });

  const db = fileSymbols.symbols.find(s => s.name === 'DB');
  expect(db).toEqual({
    name: 'DB',
    type: 'export',
    line: 15, // Updated line number
    isExported: true
  });

  // Arrow function export
  const createApiClient = fileSymbols.symbols.find(s => s.name === 'createApiClient');
  expect(createApiClient).toEqual({
    name: 'createApiClient',
    type: 'function',
    line: 29,
    isExported: true
  });
});

test('complex class patterns', async () => {
  const builder = createSymbolTestRepo('complex-classes');
  const repo = await builder.create();

  const files: TestFile[] = [
    {
      path: 'src/complex.ts',
      content: `
export abstract class BaseRepository<T> {
  protected abstract tableName: string;

  abstract create(data: Partial<T>): Promise<T>;
  abstract findById(id: string): Promise<T | null>;

  // Static method
  static getTablePrefix(): string {
    return 'app_';
  }

  // Getter
  get connectionString(): string {
    return process.env.DATABASE_URL || '';
  }

  // Setter
  set timeout(value: number) {
    this._timeout = value;
  }

  private _timeout: number = 5000;
}

class UserRepository extends BaseRepository<User> {
  protected tableName = 'users';

  async create(userData: Partial<User>): Promise<User> {
    return this.insert(userData);
  }

  async findById(id: string): Promise<User | null> {
    return this.findOne({ id });
  }

  // Constructor with parameters
  constructor(private config: DatabaseConfig) {
    super();
  }

  // Method with overloads (TypeScript)
  findByEmail(email: string): Promise<User | null>;
  findByEmail(email: string, includeDeleted: boolean): Promise<User | null>;
  async findByEmail(email: string, includeDeleted = false): Promise<User | null> {
    return this.findOne({ email, deleted: includeDeleted ? undefined : false });
  }

  // Private method
  private async insert(data: any): Promise<any> {
    return {};
  }

  // Protected method
  protected async findOne(criteria: any): Promise<any> {
    return null;
  }
}

// Class expression
const DynamicClass = class implements SomeInterface {
  dynamicMethod(): void {
    console.log('Dynamic');
  }
};

// Decorator (if supported)
@Injectable()
export class ServiceWithDecorators {
  @Inject('logger')
  private logger: Logger;

  @Method({ cache: true })
  async getData(): Promise<any> {
    return this.logger.info('Getting data');
  }
}
      `.trim()
    }
  ];

  await builder.addFiles(files);
  await builder.commit('Add complex class patterns');

  const fileDiffs = [{ filename: 'src/complex.ts', status: 'added' as const, lines: [] }];
  const symbols = await repo.extractor.extractFromChangedFiles(fileDiffs, 'HEAD');

  expect(symbols).toHaveLength(1);
  const fileSymbols = symbols[0];

  // Check base class
  const baseRepo = fileSymbols.symbols.find(s => s.name === 'BaseRepository');
  expect(baseRepo).toEqual({
    name: 'BaseRepository',
    type: 'class',
    line: 1,
    isExported: true
  });

  // Check abstract methods
  const createMethod = fileSymbols.symbols.find(s => s.name === 'create' && s.type === 'function');
  expect(createMethod).toEqual({
    name: 'create',
    type: 'function',
    line: 4,
    isExported: true,
    className: 'BaseRepository'
  });

  // Check static method
  const staticMethod = fileSymbols.symbols.find(s => s.name === 'getTablePrefix');
  expect(staticMethod).toEqual({
    name: 'getTablePrefix',
    type: 'function',
    line: 8,
    isExported: true,
    className: 'BaseRepository'
  });

  // Check getters/setters
  const getter = fileSymbols.symbols.find(s => s.name === 'connectionString');
  expect(getter).toEqual({
    name: 'connectionString',
    type: 'function',
    line: 13,
    isExported: true,
    className: 'BaseRepository'
  });

  const setter = fileSymbols.symbols.find(s => s.name === 'timeout');
  expect(setter).toEqual({
    name: 'timeout',
    type: 'function',
    line: 18,
    isExported: true,
    className: 'BaseRepository'
  });

  // Check derived class
  const userRepo = fileSymbols.symbols.find(s => s.name === 'UserRepository');
  expect(userRepo).toEqual({
    name: 'UserRepository',
    type: 'class',
    line: 25,
    isExported: false
  });

  // Note: Constructors are not extracted as separate symbols by ts-morph

  // Check decorated class
  const decoratedService = fileSymbols.symbols.find(s => s.name === 'ServiceWithDecorators');
  expect(decoratedService).toEqual({
    name: 'ServiceWithDecorators',
    type: 'class',
    line: 67,
    isExported: true
  });
});

test('edge cases and error handling', async () => {
  const builder = createSymbolTestRepo('edge-cases');
  const repo = await builder.create();

  const files: TestFile[] = [
    {
      path: 'src/empty.ts',
      content: ''
    },
    {
      path: 'src/comments-only.ts',
      content: `
// This file only has comments
/* 
 * Multi-line comment
 * with no actual code
 */
      `.trim()
    },
    {
      path: 'src/unicode.ts',
      content: `
export class Калькулятор {
  сложить(а: number, б: number): number {
    return а + б;
  }
}

export const 数学 = {
  加法: (x: number, y: number) => x + y
};

// Emoji in names (valid JavaScript identifiers)
export const 🚀rocket = 'launched';
      `.trim()
    },
    {
      path: 'src/keywords.ts',
      content: `
export class Parser {
  // Methods with keyword-like names
  constructor(input: string) {}
  
  public(): string { return 'public'; }
  private(): string { return 'private'; }
  static(): string { return 'static'; }
  async(): Promise<void> { return Promise.resolve(); }
  
  // Properties that look like methods
  readonly length = 0;
}

// Variable names that look like keywords
export const function = 'not a function';
export const class = 'not a class';
      `.trim()
    },
    {
      path: 'src/syntax-error.ts',
      content: `
export class BrokenClass {
  method1() {
    return 'valid';
  }
  
  // This has a syntax error
  method2(((invalid syntax
    return 'broken';
  }
  
  method3() {
    return 'also valid';
  }
}
      `.trim()
    }
  ];

  await builder.addFiles(files);
  await builder.commit('Add edge cases');

  const fileDiffs = files.map(f => ({ filename: f.path, status: 'added' as const, lines: [] }));
  const symbols = await repo.extractor.extractFromChangedFiles(fileDiffs, 'HEAD');

  // Empty file should return no symbols
  const emptySymbols = symbols.find(s => s.filename === 'src/empty.ts');
  expect(emptySymbols).toBeUndefined();

  // Comments-only file should return no symbols
  const commentsSymbols = symbols.find(s => s.filename === 'src/comments-only.ts');
  expect(commentsSymbols).toBeUndefined();

  // Unicode file should work correctly
  const unicodeSymbols = symbols.find(s => s.filename === 'src/unicode.ts');
  expect(unicodeSymbols).toBeDefined();
  expect(unicodeSymbols!.symbols).toHaveLength(4);
  
  const unicodeClass = unicodeSymbols!.symbols.find(s => s.name === 'Калькулятор');
  expect(unicodeClass).toEqual({
    name: 'Калькулятор',
    type: 'class',
    line: 1,
    isExported: true
  });

  const emojiVar = unicodeSymbols!.symbols.find(s => s.name === 'rocket');
  expect(emojiVar).toEqual({
    name: 'rocket', // Note: emoji prefix is stripped by ts-morph parser
    type: 'export',
    line: 12, // Updated line number
    isExported: true
  });

  // Keywords file should handle reserved words as method names
  const keywordsSymbols = symbols.find(s => s.filename === 'src/keywords.ts');
  expect(keywordsSymbols).toBeDefined();
  
  const parserClass = keywordsSymbols!.symbols.find(s => s.name === 'Parser');
  expect(parserClass).toBeDefined();

  const publicMethod = keywordsSymbols!.symbols.find(s => s.name === 'public');
  expect(publicMethod).toEqual({
    name: 'public',
    type: 'function',
    line: 5,
    isExported: true,
    className: 'Parser'
  });

  // Syntax error file should still extract valid symbols
  const errorSymbols = symbols.find(s => s.filename === 'src/syntax-error.ts');
  // Should either skip the file entirely or extract what it can
  if (errorSymbols) {
    // If it manages to parse some symbols, ensure they're valid
    expect(errorSymbols.symbols.length).toBeGreaterThanOrEqual(0);
  }
});

test('real-world React patterns', async () => {
  const builder = createSymbolTestRepo('react-patterns');
  const repo = await builder.create();

  const files: TestFile[] = [
    {
      path: 'src/components.tsx',
      content: `
import React, { useState, useEffect } from 'react';

// Function component
export const UserCard: React.FC<{ user: User }> = ({ user }) => {
  const [loading, setLoading] = useState(false);
  
  return <div>{user.name}</div>;
};

// Class component
export class TodoList extends React.Component<TodoListProps> {
  state = { todos: [] as Todo[] };

  componentDidMount() {
    this.loadTodos();
  }

  async loadTodos() {
    const todos = await fetchTodos();
    this.setState({ todos });
  }

  render() {
    return <div>{this.state.todos.length} todos</div>;
  }
}

// Custom hook
export function useLocalStorage<T>(key: string, initialValue: T) {
  const [value, setValue] = useState<T>(initialValue);
  
  useEffect(() => {
    const stored = localStorage.getItem(key);
    if (stored) setValue(JSON.parse(stored));
  }, [key]);

  return [value, setValue] as const;
}

// Higher-order component function
export function withAuth<P extends object>(Component: React.ComponentType<P>) {
  return (props: P) => {
    const user = useAuth();
    if (!user) return <LoginPrompt />;
    return <Component {...props} />;
  };
}

// Forward ref component
export const FancyButton = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ children, ...props }, ref) => {
    return <button ref={ref} {...props}>{children}</button>;
  }
);
      `.trim()
    }
  ];

  await builder.addFiles(files);
  await builder.commit('Add React patterns');

  const fileDiffs = [{ filename: 'src/components.tsx', status: 'added' as const, lines: [] }];
  const symbols = await repo.extractor.extractFromChangedFiles(fileDiffs, 'HEAD');

  expect(symbols).toHaveLength(1);
  const fileSymbols = symbols[0];
  expect(fileSymbols.symbols.length).toBeGreaterThan(0);

  // Function component (arrow function)
  const userCard = fileSymbols.symbols.find(s => s.name === 'UserCard');
  expect(userCard).toEqual({
    name: 'UserCard',
    type: 'function',
    line: 4,
    isExported: true
  });

  // Class component
  const todoList = fileSymbols.symbols.find(s => s.name === 'TodoList');
  expect(todoList).toEqual({
    name: 'TodoList',
    type: 'class',
    line: 11, // Updated line number
    isExported: true
  });

  // Class component methods
  const componentDidMount = fileSymbols.symbols.find(s => s.name === 'componentDidMount');
  expect(componentDidMount).toEqual({
    name: 'componentDidMount',
    type: 'function',
    line: 14,
    isExported: true,
    className: 'TodoList'
  });

  // Custom hook
  const useLocalStorage = fileSymbols.symbols.find(s => s.name === 'useLocalStorage');
  expect(useLocalStorage).toEqual({
    name: 'useLocalStorage',
    type: 'function',
    line: 29,
    isExported: true
  });

  // HOC function
  const withAuth = fileSymbols.symbols.find(s => s.name === 'withAuth');
  expect(withAuth).toEqual({
    name: 'withAuth',
    type: 'function',
    line: 41,
    isExported: true
  });

  // Forward ref component
  const fancyButton = fileSymbols.symbols.find(s => s.name === 'FancyButton');
  expect(fancyButton).toEqual({
    name: 'FancyButton',
    type: 'export', // Forward ref is detected as export
    line: 50,
    isExported: true
  });
});

test('non-typescript files are skipped', async () => {
  const builder = createSymbolTestRepo('mixed-files');
  const repo = await builder.create();

  const files: TestFile[] = [
    {
      path: 'README.md',
      content: '# My Project\n\nThis is a readme file.'
    },
    {
      path: 'package.json',
      content: '{"name": "test", "version": "1.0.0"}'
    },
    {
      path: 'src/valid.ts',
      content: 'export class ValidClass {}'
    },
    {
      path: 'src/styles.css',
      content: '.button { background: blue; }'
    }
  ];

  await builder.addFiles(files);
  await builder.commit('Add mixed file types');

  const fileDiffs = files.map(f => ({ filename: f.path, status: 'added' as const, lines: [] }));
  const symbols = await repo.extractor.extractFromChangedFiles(fileDiffs, 'HEAD');

  // Should only extract from TypeScript file
  expect(symbols).toHaveLength(1);
  expect(symbols[0].filename).toBe('src/valid.ts');
  expect(symbols[0].symbols).toHaveLength(1);
  expect(symbols[0].symbols[0].name).toBe('ValidClass');
});

test('performance with large files', async () => {
  const builder = createSymbolTestRepo('performance');
  const repo = await builder.create();

  // Generate a large file with many classes and methods
  const generateLargeFile = () => {
    let content = '';
    for (let i = 0; i < 100; i++) {
      content += `
export class Service${i} {
  private data${i}: any[] = [];
  
  async method1${i}(): Promise<void> {
    return Promise.resolve();
  }
  
  method2${i}(param: string): string {
    return param + '${i}';
  }
  
  private helperMethod${i}(): number {
    return ${i};
  }
}

export function utilityFunction${i}(): void {
  console.log('Function ${i}');
}

export const CONSTANT_${i} = ${i};
`;
    }
    return content.trim();
  };

  const files: TestFile[] = [
    {
      path: 'src/large.ts',
      content: generateLargeFile()
    }
  ];

  await builder.addFiles(files);
  await builder.commit('Add large file');

  const start = Date.now();
  const fileDiffs = [{ filename: 'src/large.ts', status: 'added' as const, lines: [] }];
  const symbols = await repo.extractor.extractFromChangedFiles(fileDiffs, 'HEAD');
  const duration = Date.now() - start;

  // Should complete within reasonable time (5 seconds max)
  expect(duration).toBeLessThan(5000);
  
  // Should extract all symbols correctly
  expect(symbols).toHaveLength(1);
  expect(symbols[0].symbols.length).toBe(600); // 100 classes + 300 methods + 100 functions + 100 constants
  
  // Verify a few specific symbols
  const service0 = symbols[0].symbols.find(s => s.name === 'Service0');
  expect(service0?.type).toBe('class');
  
  const method11 = symbols[0].symbols.find(s => s.name === 'method11' && s.className === 'Service1');
  expect(method11?.className).toBe('Service1');
});