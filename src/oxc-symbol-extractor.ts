/**
 * High-performance symbol extractor using OXC parser
 * Much faster alternative to ts-morph for symbol extraction
 */

import { createHash } from 'node:crypto';
import { parseSync } from 'oxc-parser';
import type { SimpleGit } from 'simple-git';
import { simpleGit } from 'simple-git';
import { APP_CONFIG } from './config';
import type { FileDiff } from './types/git';

export type OxcSymbol =
  | {
      type: 'class';
      name: string;
      line: number;
      isExported: boolean;
    }
  | {
      type: 'function';
      name: string;
      line: number;
      isExported: boolean;
      className?: string; // Present for class methods, undefined for standalone functions
    }
  | {
      type: 'export';
      name: string;
      line: number;
      isExported: true; // Exports are always exported
    };

export interface OxcImport {
  module: string;
  isRelative: boolean;
  importedSymbols: string[];
  line: number;
}

export interface OxcExport {
  module: string | null;
  exportedSymbols: string[];
  isReExport: boolean;
  line: number;
}

export interface OxcFileSymbols {
  filename: string;
  symbols: OxcSymbol[];
  imports?: OxcImport[];
  exports?: OxcExport[];
}

export class OxcSymbolExtractor {
  private repoPath: string;
  private git: SimpleGit;
  private cache = new Map<string, OxcFileSymbols>();
  private fileHashCache = new Map<string, string>();

  constructor(repoPath?: string) {
    this.repoPath = repoPath || APP_CONFIG.DEFAULT_REPO_PATH;
    this.git = simpleGit(this.repoPath);
  }

  /**
   * Generate cache key for file content
   */
  private generateCacheKey(filename: string, content: string): string {
    const contentHash = createHash('md5').update(content).digest('hex');
    return `${filename}:${contentHash}`;
  }

  /**
   * Extract symbols and dependencies from changed files (with caching)
   */
  async extractFromChangedFiles(
    files: FileDiff[],
    baseBranch: string,
    includeDependencies = false
  ): Promise<OxcFileSymbols[]> {
    const result: OxcFileSymbols[] = [];
    const uncachedFiles: FileDiff[] = [];

    // Check cache first
    for (const file of files) {
      if (this.isSupportedFile(file.filename)) {
        try {
          const content = await this.getFileContent(file.filename, baseBranch);
          const cacheKey = this.generateCacheKey(file.filename, content);

          const cached = this.cache.get(cacheKey);
          if (cached) {
            result.push(cached);
          } else {
            uncachedFiles.push(file);
            // Store content for later processing
            this.fileHashCache.set(file.filename, content);
          }
        } catch (_error) {
          // Ignore errors when reading file content from git
        }
      }
    }

    // Process uncached files in parallel batches
    if (uncachedFiles.length > 0) {
      const BATCH_SIZE = 10; // OXC is faster, so we can handle larger batches
      const batches = this.createBatches(uncachedFiles, BATCH_SIZE);

      for (const batch of batches) {
        const batchResults = await Promise.all(
          batch.map((file) => this.processFileWithCaching(file, baseBranch, includeDependencies))
        );

        result.push(...(batchResults.filter((r) => r !== null) as OxcFileSymbols[]));
      }
    }

    return result;
  }

  /**
   * Create batches of items for parallel processing
   */
  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Process a single file and cache the result
   */
  private async processFileWithCaching(
    file: FileDiff,
    baseBranch: string,
    includeDependencies = false
  ): Promise<OxcFileSymbols | null> {
    try {
      const content =
        this.fileHashCache.get(file.filename) ||
        (await this.getFileContent(file.filename, baseBranch));
      const cacheKey = this.generateCacheKey(file.filename, content);

      const symbols = this.extractSymbolsFromContent(content, file.filename);
      const dependencies = includeDependencies
        ? this.extractDependenciesFromContent(content, file.filename)
        : null;

      if (
        symbols.length > 0 ||
        (dependencies && (dependencies.imports.length > 0 || dependencies.exports.length > 0))
      ) {
        const fileSymbols: OxcFileSymbols = {
          filename: file.filename,
          symbols,
          ...(dependencies && {
            imports: dependencies.imports,
            exports: dependencies.exports,
          }),
        };

        // Cache the result
        this.cache.set(cacheKey, fileSymbols);

        return fileSymbols;
      }

      return null;
    } catch (_error) {
      return null;
    } finally {
      // Clean up temporary content cache
      this.fileHashCache.delete(file.filename);
    }
  }

  /**
   * Convert byte position to line number
   */
  private getLineNumber(content: string, bytePosition: number): number {
    if (bytePosition === undefined || bytePosition < 0) {
      return 1;
    }

    let line = 1;
    for (let i = 0; i < bytePosition && i < content.length; i++) {
      if (content[i] === '\n') {
        line++;
      }
    }
    return line;
  }

  /**
   * Extract imports and exports from file content using OXC parser
   */
  extractDependenciesFromContent(
    content: string,
    filename: string
  ): { imports: OxcImport[]; exports: OxcExport[] } {
    const imports: OxcImport[] = [];
    const exports: OxcExport[] = [];

    try {
      const result = parseSync(filename, content, {
        sourceType: 'module',
      });

      for (const node of result.program.body) {
        this.processTopLevelNode(node, content, imports, exports);
      }
    } catch (_error) {
      // Ignore parsing errors when extracting dependencies
    }

    return { imports, exports };
  }

  /**
   * Process a single top-level AST node for dependency extraction
   */
  private processTopLevelNode(
    node: any,
    content: string,
    imports: OxcImport[],
    exports: OxcExport[]
  ): void {
    switch (node.type) {
      case 'ImportDeclaration':
        this.processImportDeclaration(node, content, imports);
        break;
      case 'ExportNamedDeclaration':
        this.processExportNamedDeclaration(node, content, exports);
        break;
      case 'ExportDefaultDeclaration':
        this.processExportDefaultDeclaration(node, content, exports);
        break;
      case 'ExportAllDeclaration':
        this.processExportAllDeclaration(node, content, exports);
        break;
    }
  }

  /**
   * Process ImportDeclaration node
   */
  private processImportDeclaration(node: any, content: string, imports: OxcImport[]): void {
    if (!node.source?.value) {
      return;
    }

    const modulePath = node.source.value;
    const importedSymbols = this.extractImportedSymbols(node.specifiers);

    imports.push({
      module: modulePath,
      isRelative: this.isRelativeImport(modulePath),
      importedSymbols,
      line: this.getLineNumber(content, node.start),
    });
  }

  /**
   * Extract imported symbols from import specifiers
   */
  private extractImportedSymbols(specifiers: any[]): string[] {
    if (!specifiers) {
      return [];
    }

    const importedSymbols: string[] = [];

    for (const spec of specifiers) {
      const symbolName = this.getImportSymbolName(spec);
      if (symbolName) {
        importedSymbols.push(symbolName);
      }
    }

    return importedSymbols;
  }

  /**
   * Get symbol name from import specifier
   */
  private getImportSymbolName(spec: any): string | null {
    if (
      spec.type === 'ImportSpecifier' &&
      spec.imported &&
      'name' in spec.imported &&
      typeof spec.imported.name === 'string'
    ) {
      return spec.imported.name;
    }

    if (spec.type === 'ImportDefaultSpecifier' && spec.local && spec.local.name) {
      return 'default';
    }

    if (spec.type === 'ImportNamespaceSpecifier' && spec.local && spec.local.name) {
      return '*';
    }

    return null;
  }

  /**
   * Check if import is relative
   */
  private isRelativeImport(modulePath: string): boolean {
    return modulePath.startsWith('./') || modulePath.startsWith('../');
  }

  /**
   * Process ExportNamedDeclaration node
   */
  private processExportNamedDeclaration(node: any, content: string, exports: OxcExport[]): void {
    const exportedSymbols: string[] = [];
    let isReExport = false;
    let module: string | null = null;

    if (node.source?.value) {
      isReExport = true;
      module = node.source.value;
    }

    this.extractExportSpecifierSymbols(node.specifiers, exportedSymbols);
    this.extractDeclarationExportSymbols(node.declaration, exportedSymbols);

    if (exportedSymbols.length > 0) {
      exports.push({
        module,
        exportedSymbols,
        isReExport,
        line: this.getLineNumber(content, node.start),
      });
    }
  }

  /**
   * Extract symbols from export specifiers
   */
  private extractExportSpecifierSymbols(specifiers: any[], exportedSymbols: string[]): void {
    if (!specifiers) {
      return;
    }

    for (const spec of specifiers) {
      if (spec.exported && 'name' in spec.exported && typeof spec.exported.name === 'string') {
        exportedSymbols.push(spec.exported.name);
      }
    }
  }

  /**
   * Extract symbols from export declaration
   */
  private extractDeclarationExportSymbols(declaration: any, exportedSymbols: string[]): void {
    if (declaration) {
      this.extractExportNamesFromDeclaration(declaration, exportedSymbols);
    }
  }

  /**
   * Process ExportDefaultDeclaration node
   */
  private processExportDefaultDeclaration(node: any, content: string, exports: OxcExport[]): void {
    exports.push({
      module: null,
      exportedSymbols: ['default'],
      isReExport: false,
      line: this.getLineNumber(content, node.start),
    });
  }

  /**
   * Process ExportAllDeclaration node
   */
  private processExportAllDeclaration(node: any, content: string, exports: OxcExport[]): void {
    if (node.source?.value) {
      exports.push({
        module: node.source.value,
        exportedSymbols: ['*'],
        isReExport: true,
        line: this.getLineNumber(content, node.start),
      });
    }
  }

  /**
   * Extract export names from a declaration node
   */
  private extractExportNamesFromDeclaration(node: unknown, exportedSymbols: string[]): void {
    const nodeWithType = node as { type: string; id?: { name?: string }; declarations?: unknown[] };
    switch (nodeWithType.type) {
      case 'ClassDeclaration':
      case 'FunctionDeclaration':
      case 'TSInterfaceDeclaration':
        if (nodeWithType.id?.name) {
          exportedSymbols.push(nodeWithType.id.name);
        }
        break;
      case 'VariableDeclaration':
        if (nodeWithType.declarations) {
          for (const decl of nodeWithType.declarations) {
            const declaration = decl as { id?: { name?: string } };
            if (declaration.id?.name) {
              exportedSymbols.push(declaration.id.name);
            }
          }
        }
        break;
    }
  }

  /**
   * Extract symbols from file content using OXC parser
   */
  private extractSymbolsFromContent(content: string, filename: string): OxcSymbol[] {
    const symbols: OxcSymbol[] = [];

    try {
      const result = parseSync(filename, content, {
        sourceType: 'module',
      });

      for (const node of result.program.body) {
        this.processNodeForSymbolExtraction(node, symbols, content);
      }
    } catch (_error) {
      // Ignore parsing errors when extracting symbols
    }

    return symbols;
  }

  /**
   * Process a single AST node for symbol extraction
   */
  private processNodeForSymbolExtraction(node: any, symbols: OxcSymbol[], content: string): void {
    switch (node.type) {
      case 'ExportNamedDeclaration':
        this.processExportNamedDeclarationForSymbols(node, symbols, content);
        break;
      case 'ClassDeclaration':
      case 'FunctionDeclaration':
      case 'TSInterfaceDeclaration':
        this.extractFromDeclaration(node, symbols, false, content);
        break;
    }
  }

  /**
   * Process ExportNamedDeclaration for symbol extraction
   */
  private processExportNamedDeclarationForSymbols(
    node: any,
    symbols: OxcSymbol[],
    content: string
  ): void {
    if (node.declaration) {
      this.extractFromDeclaration(node.declaration, symbols, true, content);
    }

    this.processExportSpecifiersForSymbols(node.specifiers, symbols, content);
  }

  /**
   * Process export specifiers for symbol extraction
   */
  private processExportSpecifiersForSymbols(
    specifiers: any[],
    symbols: OxcSymbol[],
    content: string
  ): void {
    if (!specifiers) {
      return;
    }

    for (const spec of specifiers) {
      if (this.isValidExportSpecifier(spec)) {
        symbols.push({
          name: spec.exported.name,
          type: 'export',
          line: this.getLineNumber(content, spec.exported.start),
          isExported: true,
        });
      }
    }
  }

  /**
   * Check if export specifier is valid
   */
  private isValidExportSpecifier(spec: any): boolean {
    return spec.exported && 'name' in spec.exported && typeof spec.exported.name === 'string';
  }

  /**
   * Extract symbols from a declaration node
   */
  private extractFromDeclaration(
    node: {
      type: string;
      id?: { name?: string };
      start?: number;
      body?: {
        body?: Array<{
          type: string;
          key?: { name?: string };
          start?: number;
        }>;
      };
      declarations?: Array<{
        id?: { name?: string };
        init?: { type: string };
        start?: number;
      }>;
    },
    symbols: OxcSymbol[],
    isExported: boolean,
    content: string
  ): void {
    switch (node.type) {
      case 'ClassDeclaration':
        this.extractFromClassDeclaration(node, symbols, isExported, content);
        break;
      case 'FunctionDeclaration':
        this.extractFromFunctionDeclaration(node, symbols, isExported, content);
        break;
      case 'TSInterfaceDeclaration':
        this.extractFromInterfaceDeclaration(node, symbols, content);
        break;
      case 'VariableDeclaration':
        this.extractFromVariableDeclaration(node, symbols, isExported, content);
        break;
    }
  }

  /**
   * Extract symbols from class declaration
   */
  private extractFromClassDeclaration(
    node: any,
    symbols: OxcSymbol[],
    isExported: boolean,
    content: string
  ): void {
    if (!node.id?.name) {
      return;
    }

    const className = node.id.name;
    symbols.push({
      name: className,
      type: 'class',
      line: this.getLineNumber(content, node.start),
      isExported,
    });

    this.extractClassMethods(node.body, className, symbols, isExported, content);
  }

  /**
   * Extract class methods from class body
   */
  private extractClassMethods(
    body: any,
    className: string,
    symbols: OxcSymbol[],
    isExported: boolean,
    content: string
  ): void {
    if (!body?.body) {
      return;
    }

    for (const member of body.body) {
      if (this.isValidMethod(member)) {
        symbols.push({
          name: member.key.name,
          type: 'function',
          line: this.getLineNumber(content, member.start),
          isExported, // Methods inherit class export status
          className: className,
        });
      }
    }
  }

  /**
   * Check if member is a valid method (not constructor)
   */
  private isValidMethod(member: any): boolean {
    return (
      member.type === 'MethodDefinition' &&
      member.key &&
      member.key.name &&
      member.key.name !== 'constructor'
    );
  }

  /**
   * Extract symbols from function declaration
   */
  private extractFromFunctionDeclaration(
    node: any,
    symbols: OxcSymbol[],
    isExported: boolean,
    content: string
  ): void {
    if (node.id?.name) {
      symbols.push({
        name: node.id.name,
        type: 'function',
        line: this.getLineNumber(content, node.start),
        isExported,
      });
    }
  }

  /**
   * Extract symbols from interface declaration
   */
  private extractFromInterfaceDeclaration(node: any, symbols: OxcSymbol[], content: string): void {
    if (node.id?.name) {
      symbols.push({
        name: node.id.name,
        type: 'export',
        line: this.getLineNumber(content, node.start),
        isExported: true,
      });
    }
  }

  /**
   * Extract symbols from variable declaration
   */
  private extractFromVariableDeclaration(
    node: any,
    symbols: OxcSymbol[],
    isExported: boolean,
    content: string
  ): void {
    if (!node.declarations) {
      return;
    }

    for (const decl of node.declarations) {
      this.extractFromVariableDeclarator(decl, symbols, isExported, content);
    }
  }

  /**
   * Extract symbols from variable declarator
   */
  private extractFromVariableDeclarator(
    decl: any,
    symbols: OxcSymbol[],
    isExported: boolean,
    content: string
  ): void {
    if (!decl.id?.name) {
      return;
    }

    const name = decl.id.name;

    if (this.isFunctionExpression(decl.init)) {
      symbols.push({
        name,
        type: 'function',
        line: this.getLineNumber(content, decl.start),
        isExported,
      });
    } else if (isExported) {
      symbols.push({
        name,
        type: 'export',
        line: this.getLineNumber(content, decl.start),
        isExported: true,
      });
    }
  }

  /**
   * Check if init is a function expression
   */
  private isFunctionExpression(init: any): boolean {
    return init && (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression');
  }

  /**
   * Check if file is supported for symbol extraction
   */
  private isSupportedFile(filename: string): boolean {
    return /\.(ts|tsx|js|jsx)$/.test(filename);
  }

  /**
   * Get file content using git show
   */
  private async getFileContent(filename: string, branch: string): Promise<string> {
    return await this.git.show([`${branch}:${filename}`]);
  }
}
