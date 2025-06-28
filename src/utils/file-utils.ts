/**
 * File system and path utilities for the Code Review application
 */

import { APP_CONFIG } from '../config';

/**
 * Detects the programming language based on file extension
 */
export function detectLanguageFromFilename(filename: string): string {
  const extension = getFileExtension(filename);
  return APP_CONFIG.LANGUAGE_MAP[extension as keyof typeof APP_CONFIG.LANGUAGE_MAP] || 'text';
}

/**
 * Gets the file extension without the dot
 */
export function getFileExtension(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() || '';
}

/**
 * Determines the content type for HTTP responses based on file extension
 */
export function getContentTypeForExtension(filename: string): string {
  const extension = getFileExtension(filename);
  return APP_CONFIG.CONTENT_TYPES[extension as keyof typeof APP_CONFIG.CONTENT_TYPES] || 'text/plain';
}

/**
 * Checks if a file should be included in dependency analysis
 */
export function isSupportedSourceFile(filename: string): boolean {
  const extension = '.' + getFileExtension(filename);
  return APP_CONFIG.SUPPORTED_EXTENSIONS.includes(extension);
}

/**
 * Checks if a language supports syntax highlighting
 */
export function isHighlightableLanguage(language: string): boolean {
  return ['typescript', 'javascript', 'ts', 'js'].includes(language.toLowerCase());
}

/**
 * Resolves a relative module path to an absolute path within the project
 */
export function resolveModulePath(
  modulePath: string, 
  currentFile: string, 
  availableFiles: Set<string>
): string | null {
  // Handle relative imports
  if (modulePath.startsWith('./') || modulePath.startsWith('../')) {
    const currentDir = currentFile.split('/').slice(0, -1);
    const pathParts = modulePath.split('/');
    
    for (const part of pathParts) {
      if (part === '.') continue;
      if (part === '..') {
        currentDir.pop();
      } else {
        currentDir.push(part);
      }
    }
    
    const resolvedPath = currentDir.join('/');
    
    // Try different extensions
    for (const ext of APP_CONFIG.SUPPORTED_EXTENSIONS) {
      const withExt = resolvedPath + ext;
      if (availableFiles.has(withExt)) {
        return withExt;
      }
    }
    
    // Try index files
    for (const ext of APP_CONFIG.SUPPORTED_EXTENSIONS) {
      const indexPath = resolvedPath + '/index' + ext;
      if (availableFiles.has(indexPath)) {
        return indexPath;
      }
    }
    
    return resolvedPath;
  }
  
  // For now, ignore external modules (npm packages)
  return null;
}