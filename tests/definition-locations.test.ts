/**
 * Comprehensive tests for definition source locations
 * Tests the accuracy of line number extraction for the OXC extractor
 */

import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SimpleGit } from 'simple-git';
import { simpleGit } from 'simple-git';
import { OxcSymbolExtractor } from '../src/oxc-symbol-extractor';

interface TestRepo {
  path: string;
  oxcExtractor: OxcSymbolExtractor;
}

interface TestFile {
  path: string;
  content: string;
}

class LocationTestRepoBuilder {
  private tempDir: string;
  private repoPath: string;
  private git!: SimpleGit;

  constructor(testName: string) {
    this.tempDir = `/tmp/location-test-${testName}-${Date.now()}`;
    this.repoPath = join(this.tempDir, 'repo');
  }

  async create(): Promise<TestRepo> {
    // Create directory structure
    mkdirSync(this.repoPath, { recursive: true });

    // Initialize git repo
    this.git = simpleGit(this.repoPath);
    await this.git.init();
    await this.git.addConfig('user.email', 'test@example.com');
    await this.git.addConfig('user.name', 'Test User');

    return {
      path: this.repoPath,
      oxcExtractor: new OxcSymbolExtractor(this.repoPath),
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
    await this.git.add('.');
    await this.git.commit(message);
  }

  cleanup(): void {
    try {
      rmSync(this.tempDir, { recursive: true, force: true });
    } catch (_error) {
      // Failed to cleanup test directory
    }
  }
}

// Test repositories cleanup tracking
const activeLocationRepos: LocationTestRepoBuilder[] = [];

function createLocationTestRepo(testName: string): LocationTestRepoBuilder {
  const repo = new LocationTestRepoBuilder(testName);
  activeLocationRepos.push(repo);
  return repo;
}

afterEach(() => {
  // Clean up all repos created during tests
  while (activeLocationRepos.length > 0) {
    const repo = activeLocationRepos.pop();
    if (repo) {
      repo.cleanup();
    }
  }
});

/**
 * Helper function to find expected line numbers in source code
 */
function findExpectedLineNumbers(content: string, symbolNames: string[]): Map<string, number> {
  const lines = content.split('\n');
  const expectedLines = new Map<string, number>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const symbolName of symbolNames) {
      const lineNumber = findSymbolInLine(line, symbolName);
      if (lineNumber !== null) {
        expectedLines.set(symbolName, i + 1);
      }
    }
  }

  return expectedLines;
}

/**
 * Check if a symbol is defined in a given line
 */
function findSymbolInLine(line: string | undefined, symbolName: string): number | null {
  if (!line) {
    return null;
  }

  if (isClassDeclaration(line, symbolName)) {
    return 1;
  }

  if (isFunctionDeclaration(line, symbolName)) {
    return 1;
  }

  if (isMethodDeclaration(line, symbolName)) {
    return 1;
  }

  if (isArrowFunctionAssignment(line, symbolName)) {
    return 1;
  }

  if (isInterfaceDeclaration(line, symbolName)) {
    return 1;
  }

  return null;
}

/**
 * Check if line contains a class declaration
 */
function isClassDeclaration(line: string, symbolName: string): boolean {
  return line.includes(`class ${symbolName}`) || line.includes(`export class ${symbolName}`);
}

/**
 * Check if line contains a function declaration
 */
function isFunctionDeclaration(line: string, symbolName: string): boolean {
  return line.includes(`function ${symbolName}`) || line.includes(`export function ${symbolName}`);
}

/**
 * Check if line contains a method declaration
 */
function isMethodDeclaration(line: string, symbolName: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith(`${symbolName}(`) || trimmed.startsWith(`async ${symbolName}(`);
}

/**
 * Check if line contains an arrow function assignment
 */
function isArrowFunctionAssignment(line: string, symbolName: string): boolean {
  return line.includes(`const ${symbolName} =`) || line.includes(`export const ${symbolName} =`);
}

/**
 * Check if line contains an interface declaration
 */
function isInterfaceDeclaration(line: string, symbolName: string): boolean {
  return (
    line.includes(`interface ${symbolName}`) || line.includes(`export interface ${symbolName}`)
  );
}

test('basic line number accuracy - classes and functions', async () => {
  const builder = createLocationTestRepo('basic-locations');
  const repo = await builder.create();

  const testContent = `// Comment line 1
// Comment line 2

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

export function generateId(): string {
  return Math.random().toString(36);
}

const processUser = (user: User) => {
  return { ...user, processed: true };
};

export const API_URL = 'https://api.example.com';

interface User {
  id: string;
  name: string;
}`;

  const files: TestFile[] = [
    {
      path: 'src/locations.ts',
      content: testContent,
    },
  ];

  await builder.addFiles(files);
  await builder.commit('Add location test file');

  const fileDiffs = [
    {
      filename: 'src/locations.ts',
      status: 'added' as const,
      lines: [],
      isNew: true,
      isDeleted: false,
    },
  ];

  // Get expected line numbers by parsing the content manually
  const expectedLines = findExpectedLineNumbers(testContent, [
    'UserService',
    'createUser',
    'findUser',
    'validateUser',
    'generateId',
    'processUser',
    'API_URL',
    'User',
  ]);

  // Test OxcSymbolExtractor
  const oxcSymbols = await repo.oxcExtractor.extractFromChangedFiles(fileDiffs, 'HEAD');
  expect(oxcSymbols).toHaveLength(1);

  const oxcFileSymbols = oxcSymbols[0];

  // Test UserService class line number
  const oxcUserService = oxcFileSymbols?.symbols.find((s) => s.name === 'UserService');
  expect(oxcUserService?.line).toBe(expectedLines.get('UserService') ?? 0);

  // Test createUser method line number
  const oxcCreateUser = oxcFileSymbols?.symbols.find((s) => s.name === 'createUser');
  expect(oxcCreateUser?.line).toBe(expectedLines.get('createUser') ?? 0);

  // Test generateId function line number
  const oxcGenerateId = oxcFileSymbols?.symbols.find((s) => s.name === 'generateId');
  expect(oxcGenerateId?.line).toBe(expectedLines.get('generateId') ?? 0);

  // Test interface line number
  const oxcUser = oxcFileSymbols?.symbols.find((s) => s.name === 'User');
  expect(oxcUser?.line).toBe(expectedLines.get('User') ?? 0);

  // Verify all symbols have valid line numbers
  for (const symbol of oxcFileSymbols?.symbols || []) {
    expect(symbol.line).toBeGreaterThan(0);
  }
});

test('complex indentation and multiline declarations', async () => {
  const builder = createLocationTestRepo('complex-locations');
  const repo = await builder.create();

  const testContent = `export class ComplexService {
  
  // Method with complex signature
  async processData<T extends BaseType>(
    data: T[],
    options: ProcessOptions = {}
  ): Promise<ProcessedData<T>> {
    return this.process(data, options);
  }

  // Getter with complex return type
  get 
    complexProperty(): Promise<SomeComplexType | null> {
    return this.fetchComplexData();
  }

  // Static method with decorators
  @staticMethod
  @deprecated
  static 
  createInstance(
    config: ServiceConfig
  ): ComplexService {
    return new ComplexService(config);
  }
}

// Arrow function spanning multiple lines
export const multiLineArrow = (
  param1: string,
  param2: number
) => {
  return param1.repeat(param2);
};

// Function with complex generics
export function 
processGeneric<
  T extends Record<string, any>,
  U extends keyof T
>(
  input: T,
  key: U
): T[U] {
  return input[key];
}

// Class with complex inheritance
export class 
  DerivedService 
    extends ComplexService 
    implements ServiceInterface {
  
  constructor(
    private readonly config: ServiceConfig
  ) {
    super(config);
  }
}`;

  const files: TestFile[] = [
    {
      path: 'src/complex.ts',
      content: testContent,
    },
  ];

  await builder.addFiles(files);
  await builder.commit('Add complex location test file');

  const fileDiffs = [
    {
      filename: 'src/complex.ts',
      status: 'added' as const,
      lines: [],
      isNew: true,
      isDeleted: false,
    },
  ];

  // Get expected line numbers
  const expectedLines = findExpectedLineNumbers(testContent, [
    'ComplexService',
    'processData',
    'complexProperty',
    'createInstance',
    'multiLineArrow',
    'processGeneric',
    'DerivedService',
  ]);

  // Test OXC extractor
  const oxcSymbols = await repo.oxcExtractor.extractFromChangedFiles(fileDiffs, 'HEAD');
  expect(oxcSymbols).toHaveLength(1);
  const oxcFileSymbols = oxcSymbols[0];

  // Test ComplexService class
  const oxcComplexService = oxcFileSymbols?.symbols.find((s) => s.name === 'ComplexService');
  expect(oxcComplexService?.line).toBe(1); // Class should be on line 1

  // Test multiline method
  const oxcProcessData = oxcFileSymbols?.symbols.find((s) => s.name === 'processData');
  // The method declaration starts on line 4
  expect(oxcProcessData?.line).toBe(4);

  // Test multiline arrow function
  const oxcMultiLineArrow = oxcFileSymbols?.symbols.find((s) => s.name === 'multiLineArrow');
  expect(oxcMultiLineArrow?.line).toBe(expectedLines.get('multiLineArrow') ?? 0);

  // Verify all symbols have valid line numbers
  for (const symbol of oxcFileSymbols?.symbols || []) {
    expect(symbol.line).toBeGreaterThan(0);
  }
});

test('edge cases - empty lines, comments, and mixed content', async () => {
  const builder = createLocationTestRepo('edge-locations');
  const repo = await builder.create();

  const testContent = `


// Lots of empty lines and comments above

/* Multi-line comment
   spanning several lines
   before the first class */

export class EmptyLinesService {
  // Comment before method
  
  
  processData(): void {
    // Implementation
  }
  
  /* Another comment */
  
  async 
  
  anotherMethod(): Promise<void> {
    // Implementation  
  }
}

// Some comments between classes

/*
 * Documentation comment
 */

class SecondClass {
  
  method1(): void {}
  
  
  method2(): void {}
}

// Trailing comments and empty lines



`;

  const files: TestFile[] = [
    {
      path: 'src/edge.ts',
      content: testContent,
    },
  ];

  await builder.addFiles(files);
  await builder.commit('Add edge case location test file');

  const fileDiffs = [
    { filename: 'src/edge.ts', status: 'added' as const, lines: [], isNew: true, isDeleted: false },
  ];

  // Test OXC extractor
  const oxcSymbols = await repo.oxcExtractor.extractFromChangedFiles(fileDiffs, 'HEAD');
  expect(oxcSymbols).toHaveLength(1);
  const oxcFileSymbols = oxcSymbols[0];

  // Find actual line numbers in the content
  const lines = testContent.split('\n');
  const emptyLinesServiceLine =
    lines.findIndex((line) => line.includes('class EmptyLinesService')) + 1;
  const processDataLine = lines.findIndex((line) => line.trim().startsWith('processData(')) + 1;
  const anotherMethodLine = lines.findIndex((line) => line.trim().startsWith('anotherMethod(')) + 1;

  // Test EmptyLinesService class
  const oxcEmptyLinesService = oxcFileSymbols?.symbols.find((s) => s.name === 'EmptyLinesService');
  expect(oxcEmptyLinesService?.line).toBe(emptyLinesServiceLine);

  // Test processData method
  const oxcProcessData = oxcFileSymbols?.symbols.find((s) => s.name === 'processData');
  expect(oxcProcessData?.line).toBe(processDataLine);

  // Test anotherMethod (multiline declaration with empty lines)
  const oxcAnotherMethod = oxcFileSymbols?.symbols.find((s) => s.name === 'anotherMethod');
  expect(oxcAnotherMethod?.line).toBe(anotherMethodLine);

  // Verify all symbols have valid line numbers
  for (const symbol of oxcFileSymbols?.symbols || []) {
    expect(symbol.line).toBeGreaterThan(0);
  }
});

test('real file - line number accuracy in actual codebase files', async () => {
  const builder = createLocationTestRepo('real-file');
  const repo = await builder.create();

  // Create a realistic file similar to what we'd find in the codebase
  const testContent = `/**
 * User service for managing user operations
 */

import { Database } from './database';
import { Logger } from './logger';
import type { User, CreateUserRequest } from './types';

export class UserService {
  private db: Database;
  private logger: Logger;

  constructor(database: Database, logger: Logger) {
    this.db = database;
    this.logger = logger;
  }

  async createUser(request: CreateUserRequest): Promise<User> {
    this.logger.info('Creating user', { email: request.email });
    
    const user = await this.db.users.create({
      email: request.email,
      name: request.name,
      createdAt: new Date(),
    });

    this.logger.info('User created', { id: user.id });
    return user;
  }

  async findUserById(id: string): Promise<User | null> {
    return this.db.users.findById(id);
  }

  async findUserByEmail(email: string): Promise<User | null> {
    return this.db.users.findByEmail(email);
  }

  async updateUser(id: string, updates: Partial<User>): Promise<User> {
    const user = await this.findUserById(id);
    if (!user) {
      throw new Error('User not found');
    }

    return this.db.users.update(id, updates);
  }

  private async validateUser(user: Partial<User>): Promise<void> {
    if (!user.email) {
      throw new Error('Email is required');
    }
    
    if (!user.name) {
      throw new Error('Name is required');
    }
  }
}

export const DEFAULT_USER_SETTINGS = {
  theme: 'light',
  notifications: true,
  language: 'en',
} as const;

export function formatUserName(user: User): string {
  return \`\${user.name} <\${user.email}>\`;
}

export const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
  return emailRegex.test(email);
};`;

  const files: TestFile[] = [
    {
      path: 'src/real-file.ts',
      content: testContent,
    },
  ];

  await builder.addFiles(files);
  await builder.commit('Add realistic file');

  const fileDiffs = [
    {
      filename: 'src/real-file.ts',
      status: 'added' as const,
      lines: [],
      isNew: true,
      isDeleted: false,
    },
  ];

  // Test OXC extractor
  const oxcSymbols = await repo.oxcExtractor.extractFromChangedFiles(fileDiffs, 'HEAD');
  expect(oxcSymbols).toHaveLength(1);
  const oxcFileSymbols = oxcSymbols[0];

  // Find actual line numbers
  const lines = testContent.split('\n');
  const userServiceLine = lines.findIndex((line) => line.includes('export class UserService')) + 1;
  const createUserLine = lines.findIndex((line) => line.trim().startsWith('async createUser(')) + 1;
  const validateUserLine =
    lines.findIndex((line) => line.trim().startsWith('private async validateUser(')) + 1;
  const formatUserNameLine =
    lines.findIndex((line) => line.includes('export function formatUserName')) + 1;
  const isValidEmailLine =
    lines.findIndex((line) => line.includes('export const isValidEmail')) + 1;

  // Test UserService class
  const oxcUserService = oxcFileSymbols?.symbols.find((s) => s.name === 'UserService');
  expect(oxcUserService?.line).toBe(userServiceLine);

  // Test createUser method
  const oxcCreateUser = oxcFileSymbols?.symbols.find((s) => s.name === 'createUser');
  expect(oxcCreateUser?.line).toBe(createUserLine);

  // Test validateUser private method
  const oxcValidateUser = oxcFileSymbols?.symbols.find((s) => s.name === 'validateUser');
  expect(oxcValidateUser?.line).toBe(validateUserLine);

  // Test standalone function
  const oxcFormatUserName = oxcFileSymbols?.symbols.find((s) => s.name === 'formatUserName');
  expect(oxcFormatUserName?.line).toBe(formatUserNameLine);

  // Test arrow function
  const oxcIsValidEmail = oxcFileSymbols?.symbols.find((s) => s.name === 'isValidEmail');
  expect(oxcIsValidEmail?.line).toBe(isValidEmailLine);

  // Debug: print symbols for troubleshooting
  for (const _s of oxcFileSymbols?.symbols || []) {
    // Symbol: ${_s.name}: line ${_s.line} (${_s.type})
  }

  // Verify all symbols have valid line numbers
  for (const symbol of oxcFileSymbols?.symbols || []) {
    expect(symbol.line).toBeGreaterThan(0);
  }
});

test('zero line number bug detection', async () => {
  const builder = createLocationTestRepo('zero-line-bug');
  const repo = await builder.create();

  const testContent = `export class TestClass {
  method1(): void {
    console.log('method1');
  }

  method2(): void {
    console.log('method2'); 
  }
}

export function testFunction(): void {
  console.log('testFunction');
}`;

  const files: TestFile[] = [
    {
      path: 'src/zero-bug.ts',
      content: testContent,
    },
  ];

  await builder.addFiles(files);
  await builder.commit('Add zero line bug test');

  const fileDiffs = [
    {
      filename: 'src/zero-bug.ts',
      status: 'added' as const,
      lines: [],
      isNew: true,
      isDeleted: false,
    },
  ];

  // Test OXC extractor
  const oxcSymbols = await repo.oxcExtractor.extractFromChangedFiles(fileDiffs, 'HEAD');
  expect(oxcSymbols).toHaveLength(1);
  const oxcFileSymbols = oxcSymbols[0];

  // Check that NO symbols have line number 0
  for (const symbol of oxcFileSymbols?.symbols || []) {
    expect(symbol.line).toBeGreaterThan(0);
  }

  // All line numbers should be reasonable (within the file)
  const lineCount = testContent.split('\n').length;

  for (const symbol of oxcFileSymbols?.symbols || []) {
    expect(symbol.line).toBeLessThanOrEqual(lineCount);
  }
});
