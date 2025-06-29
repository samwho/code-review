/**
 * OXC-based line analyzer for precise symbol detection
 * Avoids false positives from string literals and comments
 */

import { parseSync } from 'oxc-parser';

export interface SymbolOccurrence {
  name: string;
  line: number;
  column: number;
  context: 'function_call' | 'property_access' | 'identifier' | 'assignment' | 'import' | 'export';
}

/**
 * Uses OXC to precisely detect symbol references in a line of code
 * Ignores symbols inside string literals, template literals, and comments
 */
export function findSymbolReferencesInLine(
  lineContent: string,
  symbolName: string,
  lineNumber = 1
): SymbolOccurrence[] {
  if (!lineContent.trim()) {
    return [];
  }

  try {
    const processedContent = prepareContentForParsing(lineContent);
    const wrappedCode = `function temp() {\n${processedContent}\n}`;

    const result = parseSync('temp.ts', wrappedCode, {
      sourceType: 'module',
    });

    if (!result.program) {
      return [];
    }

    return extractSymbolOccurrences(result.program, symbolName, lineNumber);
  } catch (_error) {
    // If parsing fails, fall back to simple detection but still avoid strings
    return fallbackSymbolDetection(lineContent, symbolName, lineNumber);
  }
}

/**
 * Prepare content for OXC parsing
 */
function prepareContentForParsing(lineContent: string): string {
  let processedContent = lineContent.trim();

  processedContent = addMissingSemicolon(processedContent);
  processedContent = closeIncompleteBlocks(processedContent);

  return processedContent;
}

/**
 * Add semicolon if missing for incomplete statements
 */
function addMissingSemicolon(content: string): string {
  const hasProperEnding = content.endsWith(';') || content.endsWith('{') || content.endsWith('}');

  return hasProperEnding ? content : `${content};`;
}

/**
 * Close incomplete blocks
 */
function closeIncompleteBlocks(content: string): string {
  const hasOpenBrace = content.includes('{');
  const hasCloseBrace = content.includes('}');

  return hasOpenBrace && !hasCloseBrace ? `${content} }` : content;
}

/**
 * Extract symbol occurrences from parsed AST
 */
function extractSymbolOccurrences(
  program: unknown,
  symbolName: string,
  lineNumber: number
): SymbolOccurrence[] {
  const occurrences: SymbolOccurrence[] = [];

  walkAST(program, (node: unknown) => {
    const nodeWithType = node as {
      type: string;
      name?: string;
      span?: { start: { line: number; column: number } };
    };

    if (isMatchingIdentifier(nodeWithType, symbolName)) {
      const occurrence = createSymbolOccurrence(nodeWithType, symbolName, lineNumber, program);
      occurrences.push(occurrence);
    }
  });

  return occurrences;
}

/**
 * Check if node is a matching identifier
 */
function isMatchingIdentifier(node: { type: string; name?: string }, symbolName: string): boolean {
  return node.type === 'Identifier' && node.name === symbolName;
}

/**
 * Create symbol occurrence from AST node
 */
function createSymbolOccurrence(
  node: {
    name?: string;
    span?: { start: { line: number; column: number } };
  },
  symbolName: string,
  lineNumber: number,
  program: unknown
): SymbolOccurrence {
  const context = determineIdentifierContext(node, getParentNode(program, node));

  const actualLine = node.span
    ? Math.max(lineNumber, lineNumber + node.span.start.line - 1)
    : lineNumber;

  return {
    name: symbolName,
    line: actualLine,
    column: node.span?.start.column || 0,
    context,
  };
}

/**
 * Simple check if line contains symbol using OXC parsing but without full analysis
 */
export function lineContainsSymbolPrecise(lineContent: string, symbolName: string): boolean {
  const occurrences = findSymbolReferencesInLine(lineContent, symbolName);
  return occurrences.length > 0;
}

/**
 * Walk AST nodes recursively
 */
function walkAST(node: unknown, callback: (node: unknown) => void) {
  if (!node || typeof node !== 'object') {
    return;
  }

  callback(node);

  // Walk all properties that could contain child nodes
  for (const key in node as Record<string, unknown>) {
    const value = (node as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        walkAST(item, callback);
      }
    } else if (value && typeof value === 'object') {
      walkAST(value, callback);
    }
  }
}

/**
 * Get parent node of a given node (simplified approach)
 */
function getParentNode(root: unknown, targetNode: unknown): unknown {
  let parent = null;

  walkAST(root, (node: unknown) => {
    if (node !== targetNode && node && typeof node === 'object') {
      for (const key in node as Record<string, unknown>) {
        const value = (node as Record<string, unknown>)[key];
        if (value === targetNode || (Array.isArray(value) && value.includes(targetNode))) {
          parent = node;
        }
      }
    }
  });

  return parent;
}

/**
 * Determine the context of an identifier based on its parent node
 */
function determineIdentifierContext(
  identifierNode: unknown,
  parentNode: unknown
): SymbolOccurrence['context'] {
  const parent = parentNode as {
    type?: string;
    callee?: unknown;
    property?: unknown;
    left?: unknown;
    object?: unknown;
  };

  if (!parent?.type) {
    return 'identifier';
  }

  switch (parent.type) {
    case 'CallExpression':
      // Check if this identifier is the callee
      if (parent.callee === identifierNode) {
        return 'function_call';
      }
      return 'identifier';

    case 'MemberExpression':
      // Check if this is the object being accessed (obj.prop vs obj.identifier)
      if (parent.object === identifierNode) {
        return 'property_access';
      }
      return 'identifier';

    case 'AssignmentExpression':
      if (parent.left === identifierNode) {
        return 'assignment';
      }
      return 'identifier';

    case 'ImportSpecifier':
    case 'ImportDefaultSpecifier':
    case 'ImportNamespaceSpecifier':
      return 'import';

    case 'ExportSpecifier':
    case 'ExportDefaultDeclaration':
    case 'ExportNamedDeclaration':
      return 'export';

    default:
      return 'identifier';
  }
}

/**
 * Fallback detection when OXC parsing fails
 * Still avoids strings but uses simpler logic
 */
function fallbackSymbolDetection(
  lineContent: string,
  symbolName: string,
  lineNumber: number
): SymbolOccurrence[] {
  if (isCommentLine(lineContent)) {
    return [];
  }

  const cleanContent = removeStringLiterals(lineContent);
  return findSymbolInCleanContent(cleanContent, symbolName, lineNumber);
}

/**
 * Check if line is a comment
 */
function isCommentLine(lineContent: string): boolean {
  const trimmed = lineContent.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*');
}

/**
 * Remove string literals and template literals from content
 */
function removeStringLiterals(lineContent: string): string {
  const stringState = {
    inString: false,
    stringChar: '',
    inTemplate: false,
  };

  let cleanContent = '';

  for (let i = 0; i < lineContent.length; i++) {
    const char = lineContent[i];
    const prevChar = i > 0 ? lineContent[i - 1] || '' : '';

    if (char) {
      cleanContent += processCharacter(char, prevChar, stringState);
    }
  }

  return cleanContent;
}

/**
 * Process a single character considering string state
 */
function processCharacter(
  char: string,
  prevChar: string,
  state: { inString: boolean; stringChar: string; inTemplate: boolean }
): string {
  if (isOutsideStrings(state)) {
    return handleOutsideStringChar(char, state);
  }

  if (state.inString) {
    return handleInsideStringChar(char, prevChar, state);
  }

  if (state.inTemplate) {
    return handleInsideTemplateChar(char, prevChar, state);
  }

  return ' ';
}

/**
 * Check if we're outside all string types
 */
function isOutsideStrings(state: { inString: boolean; inTemplate: boolean }): boolean {
  return !(state.inString || state.inTemplate);
}

/**
 * Handle character when outside strings
 */
function handleOutsideStringChar(
  char: string,
  state: { inString: boolean; stringChar: string; inTemplate: boolean }
): string {
  if (char === '"' || char === "'") {
    state.inString = true;
    state.stringChar = char;
    return ' ';
  }

  if (char === '`') {
    state.inTemplate = true;
    return ' ';
  }

  return char;
}

/**
 * Handle character when inside string
 */
function handleInsideStringChar(
  char: string,
  prevChar: string,
  state: { inString: boolean; stringChar: string }
): string {
  if (char === state.stringChar && prevChar !== '\\') {
    state.inString = false;
    state.stringChar = '';
  }
  return ' ';
}

/**
 * Handle character when inside template literal
 */
function handleInsideTemplateChar(
  char: string,
  prevChar: string,
  state: { inTemplate: boolean }
): string {
  if (char === '`' && prevChar !== '\\') {
    state.inTemplate = false;
  }
  return ' ';
}

/**
 * Find symbol in clean content (after string removal)
 */
function findSymbolInCleanContent(
  cleanContent: string,
  symbolName: string,
  lineNumber: number
): SymbolOccurrence[] {
  const regex = new RegExp(`\\b${escapeRegExp(symbolName)}\\b`);

  if (regex.test(cleanContent)) {
    return [
      {
        name: symbolName,
        line: lineNumber,
        column: cleanContent.indexOf(symbolName),
        context: 'identifier',
      },
    ];
  }

  return [];
}

/**
 * Escape special regex characters
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
