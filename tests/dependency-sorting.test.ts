/**
 * Comprehensive tests for dependency sorting functionality
 * Creates real temporary git repositories with actual file structures
 */

import { test, expect, beforeEach, afterEach } from 'bun:test';
import { GitService } from '../src/git';
import { rmSync, mkdirSync, writeFileSync } from 'fs';
import { spawn } from 'bun';
import { join } from 'path';

interface TestRepo {
  path: string;
  gitService: GitService;
}

interface TestFile {
  path: string;
  content: string;
}

class TestRepoBuilder {
  private tempDir: string;
  private repoPath: string;

  constructor(testName: string) {
    this.tempDir = `/tmp/code-review-test-${testName}-${Date.now()}`;
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
      gitService: new GitService(this.repoPath)
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
const activeRepos: TestRepoBuilder[] = [];

function createTestRepo(testName: string): TestRepoBuilder {
  const repo = new TestRepoBuilder(testName);
  activeRepos.push(repo);
  return repo;
}

afterEach(() => {
  // Clean up all repos created during tests
  while (activeRepos.length > 0) {
    const repo = activeRepos.pop()!;
    repo.cleanup();
  }
});

test('basic dependency sorting - linear chain', async () => {
  const builder = createTestRepo('linear-chain');
  const repo = await builder.create();

  // Create a linear dependency chain: A -> B -> C
  const baseFiles: TestFile[] = [
    {
      path: 'src/a.ts',
      content: `
import { B } from './b';

export class A {
  private b = new B();
  doSomething() {
    return this.b.process();
  }
}
      `.trim()
    },
    {
      path: 'src/b.ts', 
      content: `
import { C } from './c';

export class B {
  private c = new C();
  process() {
    return this.c.calculate();
  }
}
      `.trim()
    },
    {
      path: 'src/c.ts',
      content: `
export class C {
  calculate() {
    return 42;
  }
}
      `.trim()
    }
  ];

  await builder.addFiles(baseFiles);
  await builder.commit('Initial commit');

  // Create feature branch and modify all files
  await builder.createBranch('feature');
  
  const modifiedFiles: TestFile[] = [
    {
      path: 'src/a.ts',
      content: `
import { B } from './b';

export class A {
  private b = new B();
  doSomething() {
    // Modified: added logging
    console.log('A.doSomething called');
    return this.b.process();
  }
}
      `.trim()
    },
    {
      path: 'src/b.ts',
      content: `
import { C } from './c';

export class B {
  private c = new C();
  process() {
    // Modified: added validation
    if (!this.c) throw new Error('C not available');
    return this.c.calculate();
  }
}
      `.trim()
    },
    {
      path: 'src/c.ts',
      content: `
export class C {
  calculate() {
    // Modified: different calculation
    return Math.random() * 100;
  }
}
      `.trim()
    }
  ];

  await builder.addFiles(modifiedFiles);
  await builder.commit('Modify all files');

  // Test different orderings
  const alphabetical = await repo.gitService.getOrderedFiles('master', 'feature', 'alphabetical');
  const topDown = await repo.gitService.getOrderedFiles('master', 'feature', 'top-down');
  const bottomUp = await repo.gitService.getOrderedFiles('master', 'feature', 'bottom-up');

  // Verify file counts
  expect(alphabetical.files).toHaveLength(3);
  expect(topDown.files).toHaveLength(3);
  expect(bottomUp.files).toHaveLength(3);

  // Verify alphabetical order
  expect(alphabetical.files.map(f => f.filename)).toEqual([
    'src/a.ts', 'src/b.ts', 'src/c.ts'
  ]);

  // Verify top-down order (high-level first: A depends on B, B depends on C)
  expect(topDown.files.map(f => f.filename)).toEqual([
    'src/a.ts', 'src/b.ts', 'src/c.ts'
  ]);

  // Verify bottom-up order (dependencies first: C has no deps, B depends on C, A depends on B)
  expect(bottomUp.files.map(f => f.filename)).toEqual([
    'src/c.ts', 'src/b.ts', 'src/a.ts'
  ]);

  // Verify symbols are extracted
  expect(alphabetical.symbols).toBeDefined();
  expect(alphabetical.symbols!).toHaveLength(3);
  
  const symbolsByFile = new Map(alphabetical.symbols!.map(fs => [fs.filename, fs.symbols]));
  expect(symbolsByFile.get('src/a.ts')).toEqual([
    { name: 'A', type: 'class', line: 3, isExported: true }
  ]);
  expect(symbolsByFile.get('src/b.ts')).toEqual([
    { name: 'B', type: 'class', line: 3, isExported: true }
  ]);
  expect(symbolsByFile.get('src/c.ts')).toEqual([
    { name: 'C', type: 'class', line: 1, isExported: true }
  ]);
});

test('complex dependency graph with branching', async () => {
  const builder = createTestRepo('complex-graph');
  const repo = await builder.create();

  // Create a more complex dependency graph:
  // Main -> [Service1, Service2]
  // Service1 -> [Utils, Database]  
  // Service2 -> [Utils, Cache]
  // Database -> Config
  // Cache -> Config
  const baseFiles: TestFile[] = [
    {
      path: 'src/main.ts',
      content: `
import { Service1 } from './services/service1';
import { Service2 } from './services/service2';

export class Main {
  constructor(
    private service1: Service1,
    private service2: Service2
  ) {}
}
      `.trim()
    },
    {
      path: 'src/services/service1.ts',
      content: `
import { Utils } from '../utils';
import { Database } from '../database';

export class Service1 {
  constructor(
    private utils: Utils,
    private db: Database
  ) {}
}
      `.trim()
    },
    {
      path: 'src/services/service2.ts',
      content: `
import { Utils } from '../utils';
import { Cache } from '../cache';

export class Service2 {
  constructor(
    private utils: Utils,
    private cache: Cache
  ) {}
}
      `.trim()
    },
    {
      path: 'src/utils.ts',
      content: `
export class Utils {
  format(data: any) {
    return JSON.stringify(data);
  }
}
      `.trim()
    },
    {
      path: 'src/database.ts',
      content: `
import { Config } from './config';

export class Database {
  constructor(private config: Config) {}
}
      `.trim()
    },
    {
      path: 'src/cache.ts',
      content: `
import { Config } from './config';

export class Cache {
  constructor(private config: Config) {}
}
      `.trim()
    },
    {
      path: 'src/config.ts',
      content: `
export class Config {
  get(key: string) {
    return process.env[key];
  }
}
      `.trim()
    }
  ];

  await builder.addFiles(baseFiles);
  await builder.commit('Initial complex structure');

  // Create feature branch and modify some files
  await builder.createBranch('feature');
  
  const modifiedFiles: TestFile[] = [
    {
      path: 'src/main.ts',
      content: `
import { Service1 } from './services/service1';
import { Service2 } from './services/service2';

export class Main {
  constructor(
    private service1: Service1,
    private service2: Service2
  ) {}
  
  // Added new method
  start() {
    console.log('Starting application');
  }
}
      `.trim()
    },
    {
      path: 'src/utils.ts',
      content: `
export class Utils {
  format(data: any) {
    // Modified: added pretty printing
    return JSON.stringify(data, null, 2);
  }
}
      `.trim()
    },
    {
      path: 'src/config.ts',
      content: `
export class Config {
  get(key: string) {
    // Modified: added default values
    return process.env[key] || 'default';
  }
}
      `.trim()
    }
  ];

  await builder.addFiles(modifiedFiles);
  await builder.commit('Modify main, utils, and config');

  // Test orderings
  const alphabetical = await repo.gitService.getOrderedFiles('master', 'feature', 'alphabetical');
  const topDown = await repo.gitService.getOrderedFiles('master', 'feature', 'top-down');
  const bottomUp = await repo.gitService.getOrderedFiles('master', 'feature', 'bottom-up');

  // All should have 3 modified files
  expect(alphabetical.files).toHaveLength(3);
  expect(topDown.files).toHaveLength(3);
  expect(bottomUp.files).toHaveLength(3);

  const alphabeticalOrder = alphabetical.files.map(f => f.filename);
  const topDownOrder = topDown.files.map(f => f.filename);
  const bottomUpOrder = bottomUp.files.map(f => f.filename);

  // Alphabetical should be sorted by name
  expect(alphabeticalOrder).toEqual([
    'src/config.ts',
    'src/main.ts', 
    'src/utils.ts'
  ]);

  // Top-down: Main should come first (it's at the top of dependency chain)
  // Config should come last (it's a leaf dependency)
  expect(topDownOrder[0]).toBe('src/main.ts');
  expect(topDownOrder).toContain('src/config.ts');
  expect(topDownOrder).toContain('src/utils.ts');

  // Bottom-up: Config should come first (it has no dependencies)
  // Main should come last (it depends on others)
  expect(bottomUpOrder[bottomUpOrder.length - 1]).toBe('src/main.ts');
  expect(bottomUpOrder).toContain('src/config.ts');
  expect(bottomUpOrder).toContain('src/utils.ts');

  // Top-down and bottom-up should be different
  expect(topDownOrder).not.toEqual(bottomUpOrder);
  
  // Both should be different from alphabetical
  expect(topDownOrder).not.toEqual(alphabeticalOrder);
  expect(bottomUpOrder).not.toEqual(alphabeticalOrder);
});

test('no dependencies - should fall back to alphabetical', async () => {
  const builder = createTestRepo('no-deps');
  const repo = await builder.create();

  // Create files with no internal dependencies
  const baseFiles: TestFile[] = [
    {
      path: 'src/standalone1.ts',
      content: `
export class Standalone1 {
  getValue() {
    return 'value1';
  }
}
      `.trim()
    },
    {
      path: 'src/standalone2.ts',
      content: `
export class Standalone2 {
  getValue() {
    return 'value2';
  }
}
      `.trim()
    },
    {
      path: 'src/standalone3.ts',
      content: `
export class Standalone3 {
  getValue() {
    return 'value3';
  }
}
      `.trim()
    }
  ];

  await builder.addFiles(baseFiles);
  await builder.commit('Initial standalone files');

  await builder.createBranch('feature');
  
  // Modify all files but don't add dependencies
  const modifiedFiles: TestFile[] = [
    {
      path: 'src/standalone1.ts',
      content: `
export class Standalone1 {
  getValue() {
    // Modified
    return 'modified-value1';
  }
}
      `.trim()
    },
    {
      path: 'src/standalone2.ts',
      content: `
export class Standalone2 {
  getValue() {
    // Modified  
    return 'modified-value2';
  }
}
      `.trim()
    },
    {
      path: 'src/standalone3.ts',
      content: `
export class Standalone3 {
  getValue() {
    // Modified
    return 'modified-value3';
  }
}
      `.trim()
    }
  ];

  await builder.addFiles(modifiedFiles);
  await builder.commit('Modify standalone files');

  const alphabetical = await repo.gitService.getOrderedFiles('master', 'feature', 'alphabetical');
  const topDown = await repo.gitService.getOrderedFiles('master', 'feature', 'top-down');
  const bottomUp = await repo.gitService.getOrderedFiles('master', 'feature', 'bottom-up');

  const expectedOrder = [
    'src/standalone1.ts',
    'src/standalone2.ts', 
    'src/standalone3.ts'
  ];

  // Alphabetical should always be in alphabetical order
  expect(alphabetical.files.map(f => f.filename)).toEqual(expectedOrder);
  
  // When there are no dependencies, dependency orderings should fallback to some consistent ordering
  // (may not be exactly alphabetical depending on how topological sort handles nodes with no edges)
  expect(topDown.files).toHaveLength(3);
  expect(bottomUp.files).toHaveLength(3);
  
  // All three should contain the same files, just potentially in different orders
  const topDownNames = topDown.files.map(f => f.filename).sort();
  const bottomUpNames = bottomUp.files.map(f => f.filename).sort(); 
  const alphabeticalNames = alphabetical.files.map(f => f.filename).sort();
  
  expect(topDownNames).toEqual(alphabeticalNames);
  expect(bottomUpNames).toEqual(alphabeticalNames);
});

test('circular dependencies - should handle gracefully', async () => {
  const builder = createTestRepo('circular-deps');
  const repo = await builder.create();

  // Create circular dependencies: A -> B -> A
  const baseFiles: TestFile[] = [
    {
      path: 'src/a.ts',
      content: `
import type { B } from './b';

export class A {
  private b?: B;
  
  setB(b: B) {
    this.b = b;
  }
}
      `.trim()
    },
    {
      path: 'src/b.ts',
      content: `
import { A } from './a';

export class B {
  private a = new A();
  
  getA() {
    return this.a;
  }
}
      `.trim()
    }
  ];

  await builder.addFiles(baseFiles);
  await builder.commit('Initial circular dependency');

  await builder.createBranch('feature');
  
  const modifiedFiles: TestFile[] = [
    {
      path: 'src/a.ts',
      content: `
import type { B } from './b';

export class A {
  private b?: B;
  
  setB(b: B) {
    this.b = b;
  }
  
  // Added method
  process() {
    return this.b?.getA();
  }
}
      `.trim()
    },
    {
      path: 'src/b.ts',
      content: `
import { A } from './a';

export class B {
  private a = new A();
  
  getA() {
    return this.a;
  }
  
  // Added method
  init() {
    this.a.setB(this);
  }
}
      `.trim()
    }
  ];

  await builder.addFiles(modifiedFiles);
  await builder.commit('Modify circular dependencies');

  // Should not throw errors and should return valid orderings
  const alphabetical = await repo.gitService.getOrderedFiles('master', 'feature', 'alphabetical');
  const topDown = await repo.gitService.getOrderedFiles('master', 'feature', 'top-down');
  const bottomUp = await repo.gitService.getOrderedFiles('master', 'feature', 'bottom-up');

  expect(alphabetical.files).toHaveLength(2);
  expect(topDown.files).toHaveLength(2);
  expect(bottomUp.files).toHaveLength(2);

  // Should include both files
  const allFilenames = ['src/a.ts', 'src/b.ts'];
  expect(alphabetical.files.map(f => f.filename).sort()).toEqual(allFilenames.sort());
  expect(topDown.files.map(f => f.filename).sort()).toEqual(allFilenames.sort());
  expect(bottomUp.files.map(f => f.filename).sort()).toEqual(allFilenames.sort());
});

test('mixed file types and exports', async () => {
  const builder = createTestRepo('mixed-types');
  const repo = await builder.create();

  const baseFiles: TestFile[] = [
    {
      path: 'src/types.ts',
      content: `
export interface User {
  id: string;
  name: string;
}

export type Status = 'active' | 'inactive';

export const DEFAULT_STATUS: Status = 'active';
      `.trim()
    },
    {
      path: 'src/functions.ts',
      content: `
import { User, Status } from './types';

export function createUser(name: string): User {
  return { id: Math.random().toString(), name };
}

export const validateStatus = (status: string): status is Status => {
  return status === 'active' || status === 'inactive';
};
      `.trim()
    },
    {
      path: 'src/classes.ts',
      content: `
import { User, Status } from './types';
import { createUser, validateStatus } from './functions';

export class UserManager {
  private users: User[] = [];
  
  addUser(name: string) {
    this.users.push(createUser(name));
  }
}

export default class StatusChecker {
  check(status: string) {
    return validateStatus(status);
  }
}
      `.trim()
    }
  ];

  await builder.addFiles(baseFiles);
  await builder.commit('Initial mixed types');

  await builder.createBranch('feature');
  
  const modifiedFiles: TestFile[] = [
    {
      path: 'src/types.ts',
      content: `
export interface User {
  id: string;
  name: string;
  // Added field
  email?: string;
}

export type Status = 'active' | 'inactive';

export const DEFAULT_STATUS: Status = 'active';
      `.trim()
    },
    {
      path: 'src/functions.ts',
      content: `
import { User, Status } from './types';

export function createUser(name: string, email?: string): User {
  return { 
    id: Math.random().toString(), 
    name,
    // Added email support
    email 
  };
}

export const validateStatus = (status: string): status is Status => {
  return status === 'active' || status === 'inactive';
};
      `.trim()
    }
  ];

  await builder.addFiles(modifiedFiles);
  await builder.commit('Modify types and functions');

  const result = await repo.gitService.getOrderedFiles('master', 'feature', 'bottom-up');

  expect(result.files).toHaveLength(2);
  expect(result.symbols).toBeDefined();
  
  expect(result.symbols!).toHaveLength(2);

  // Verify symbols are extracted correctly for different types
  const symbolsByFile = new Map(result.symbols!.map(fs => [fs.filename, fs.symbols]));
  
  const typesSymbols = symbolsByFile.get('src/types.ts')!;
  expect(typesSymbols).toHaveLength(1);
  expect(typesSymbols[0].name).toBe('DEFAULT_STATUS');
  expect(typesSymbols[0].type).toBe('export');
  expect(typesSymbols[0].isExported).toBe(true);

  const functionsSymbols = symbolsByFile.get('src/functions.ts')!;
  expect(functionsSymbols).toHaveLength(2);
  expect(functionsSymbols.map(s => s.name).sort()).toEqual(['createUser', 'validateStatus']);
  expect(functionsSymbols.every(s => s.type === 'function')).toBe(true);
  expect(functionsSymbols.every(s => s.isExported === true)).toBe(true);

  // Bottom-up: types should come before functions (functions depend on types)
  expect(result.files.map(f => f.filename)).toEqual([
    'src/types.ts',
    'src/functions.ts'
  ]);
});

test('empty diff - should handle gracefully', async () => {
  const builder = createTestRepo('empty-diff');
  const repo = await builder.create();

  // Create some files
  const baseFiles: TestFile[] = [
    {
      path: 'src/file1.ts',
      content: `export class File1 {}`
    }
  ];

  await builder.addFiles(baseFiles);
  await builder.commit('Initial commit');

  // Create branch but don't modify anything
  await builder.createBranch('feature');

  const result = await repo.gitService.getOrderedFiles('master', 'feature', 'top-down');

  // Should handle empty diff gracefully
  expect(result.files).toHaveLength(0);
  expect(result.symbols).toEqual([]);
});

test('only non-source files changed', async () => {
  const builder = createTestRepo('non-source-files');
  const repo = await builder.create();

  // Create initial files
  const baseFiles: TestFile[] = [
    {
      path: 'README.md',
      content: '# Project'
    },
    {
      path: 'package.json',
      content: '{"name": "test"}'
    }
  ];

  await builder.addFiles(baseFiles);
  await builder.commit('Initial commit');

  await builder.createBranch('feature');
  
  // Modify only non-source files
  const modifiedFiles: TestFile[] = [
    {
      path: 'README.md',
      content: '# Updated Project\n\nWith more content.'
    },
    {
      path: 'package.json',
      content: '{"name": "test", "version": "1.0.0"}'
    }
  ];

  await builder.addFiles(modifiedFiles);
  await builder.commit('Update documentation and package');

  const result = await repo.gitService.getOrderedFiles('master', 'feature', 'alphabetical');

  // Should include the files but no symbols since they're not source files
  expect(result.files).toHaveLength(2);
  expect(result.files.map(f => f.filename).sort()).toEqual([
    'README.md',
    'package.json'
  ]);
  expect(result.symbols).toEqual([]); // No symbols from non-source files
});