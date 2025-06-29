/**
 * Configuration constants for the Code Review application
 */

export const APP_CONFIG = {
  // Server configuration
  DEFAULT_PORT: 3000,
  HOSTNAME: '0.0.0.0',
  
  // Git configuration
  DEFAULT_REPO_PATH: './test-repos/basic-typescript-api',
  
  // File extensions supported for analysis
  SUPPORTED_EXTENSIONS: ['.ts', '.js', '.tsx', '.jsx'],
  
  // Language detection mappings
  LANGUAGE_MAP: {
    'ts': 'typescript',
    'tsx': 'typescript', 
    'js': 'javascript',
    'jsx': 'javascript'
  },
  
  // Content type mappings for static files
  CONTENT_TYPES: {
    'html': 'text/html',
    'css': 'text/css',
    'js': 'application/javascript',
    'json': 'application/json',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'svg': 'image/svg+xml'
  } as const,
  
  // TypeScript compiler options for semantic analysis
  TS_COMPILER_OPTIONS: {
    target: 'ES2020',
    module: 'ESNext',
    moduleResolution: 'bundler',
    allowJs: true,
    allowImportingTsExtensions: true,
    declaration: false,
    skipLibCheck: true,
    strict: false, // Relax for better compatibility with diverse codebases
  },
  
  // Keywords to exclude from symbol analysis
  TYPESCRIPT_KEYWORDS: new Set([
    'abstract', 'any', 'as', 'async', 'await', 'boolean', 'break', 'case', 'catch', 'class',
    'const', 'constructor', 'continue', 'debugger', 'declare', 'default', 'delete', 'do',
    'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'from', 'function',
    'get', 'if', 'implements', 'import', 'in', 'instanceof', 'interface', 'is', 'keyof',
    'let', 'module', 'namespace', 'never', 'new', 'null', 'number', 'object', 'of',
    'package', 'private', 'protected', 'public', 'readonly', 'return', 'set', 'static',
    'string', 'super', 'switch', 'symbol', 'this', 'throw', 'true', 'try', 'type',
    'typeof', 'undefined', 'union', 'unknown', 'var', 'void', 'while', 'with', 'yield'
  ]),
  
  // Built-in symbols to exclude from highlighting
  BUILTIN_SYMBOLS: new Set([
    'console', 'log', 'error', 'warn', 'info', 'debug', 'trace',
    'window', 'document', 'global', 'process', 'Buffer',
    'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
    'fetch', 'Response', 'Request', 'URL', 'URLSearchParams',
    'Object', 'Array', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt',
    'Function', 'Date', 'RegExp', 'Error', 'TypeError', 'ReferenceError',
    'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'Proxy', 'Reflect',
    'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf',
    'propertyIsEnumerable', 'toLocaleString', 'constructor',
    'length', 'prototype', 'name', 'message',
    'exports', 'module', 'require', '__dirname', '__filename',
    'JSON', 'Math', 'Infinity', 'NaN', 'undefined', 'null'
  ])
} as const;

// Type definitions
export type SupportedLanguage = 'typescript' | 'javascript' | 'text';
export type FileOrder = 'top-down' | 'bottom-up' | 'alphabetical';
export type DiffLineType = 'added' | 'removed' | 'context';

// Type guard for supported extensions
export function isSupportedExtension(ext: string): boolean {
  return APP_CONFIG.SUPPORTED_EXTENSIONS.includes(ext as any);
}

// Type guard for supported languages
export function isSupportedLanguage(lang: string): lang is SupportedLanguage {
  return lang === 'typescript' || lang === 'javascript' || lang === 'text';
}