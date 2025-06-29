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
    // Parse the line as TypeScript/JavaScript
    // We wrap it in a minimal function to ensure it's valid syntax for parsing
    // Handle incomplete statements by adding closing braces/semicolons as needed
    let processedContent = lineContent.trim();

    // Add semicolon if missing (for incomplete statements)
    if (
      !processedContent.endsWith(';') &&
      !processedContent.endsWith('{') &&
      !processedContent.endsWith('}')
    ) {
      processedContent += ';';
    }

    // Close incomplete blocks
    if (processedContent.includes('{') && !processedContent.includes('}')) {
      processedContent += ' }';
    }

    const wrappedCode = `function temp() {\n${processedContent}\n}`;

    const result = parseSync('temp.ts', wrappedCode, {
      sourceType: 'module',
      allowReturnOutsideFunction: true,
    });

    if (!result.program) {
      return [];
    }

    const occurrences: SymbolOccurrence[] = [];

    // Walk the AST to find identifier references
    walkAST(result.program, (node: unknown) => {
      const nodeWithType = node as {
        type: string;
        name?: string;
        span?: { start: { line: number; column: number } };
      };
      // Only look for identifiers that match our symbol name
      if (nodeWithType.type === 'Identifier' && nodeWithType.name === symbolName) {
        // Determine context based on parent node
        const context = determineIdentifierContext(
          nodeWithType,
          getParentNode(result.program, nodeWithType)
        );

        // Adjust line number (subtract 1 because we added wrapper function)
        const actualLine = nodeWithType.span
          ? Math.max(lineNumber, lineNumber + nodeWithType.span.start.line - 1)
          : lineNumber;

        occurrences.push({
          name: symbolName,
          line: actualLine,
          column: nodeWithType.span?.start.column || 0,
          context,
        });
      }
    });

    return occurrences;
  } catch (_error) {
    // If parsing fails, fall back to simple detection but still avoid strings
    return fallbackSymbolDetection(lineContent, symbolName, lineNumber);
  }
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
  for (const key in node) {
    const value = node[key];
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
      for (const key in node) {
        const value = node[key];
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
  const _identifier = identifierNode as { type: string };
  const parent = parentNode as {
    type?: string;
    callee?: unknown;
    property?: unknown;
    left?: unknown;
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

// Legacy implementation that was replaced
function _determineIdentifierContextOld(
  identifierNode: unknown,
  parentNode: unknown
): SymbolOccurrence['context'] {
  if (!parentNode) {
    return 'identifier';
  }

  switch (parentNode.type) {
    case 'CallExpression':
      // Check if this identifier is the callee
      if (parentNode.callee === identifierNode) {
        return 'function_call';
      }
      return 'identifier';

    case 'MemberExpression':
      // Check if this is the object being accessed (obj.prop vs obj.identifier)
      if (parentNode.object === identifierNode) {
        return 'property_access';
      }
      return 'identifier';

    case 'AssignmentExpression':
      if (parentNode.left === identifierNode) {
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
  // Skip obvious comments
  const trimmed = lineContent.trim();
  if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
    return [];
  }

  // Basic string detection (not perfect but better than regex)
  let inString = false;
  let stringChar = '';
  let inTemplate = false;
  let cleanContent = '';

  for (let i = 0; i < lineContent.length; i++) {
    const char = lineContent[i];
    const prevChar = i > 0 ? lineContent[i - 1] : '';

    if (!inString && !inTemplate) {
      if (char === '"' || char === "'") {
        inString = true;
        stringChar = char;
        cleanContent += ' '; // Replace string content with space
      } else if (char === '`') {
        inTemplate = true;
        cleanContent += ' '; // Replace template content with space
      } else {
        cleanContent += char;
      }
    } else if (inString) {
      if (char === stringChar && prevChar !== '\\') {
        inString = false;
        stringChar = '';
      }
      cleanContent += ' '; // Replace string content with space
    } else if (inTemplate) {
      if (char === '`' && prevChar !== '\\') {
        inTemplate = false;
      }
      cleanContent += ' '; // Replace template content with space
    }
  }

  // Now check for symbol in clean content
  const regex = new RegExp(`\\b${symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
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
