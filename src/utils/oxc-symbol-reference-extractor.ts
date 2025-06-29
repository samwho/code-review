/**
 * OXC-based symbol reference extractor
 * Extracts both symbol definitions AND references in one pass for maximum performance
 */

import { parseSync } from 'oxc-parser';

export interface SymbolReference {
  name: string;
  line: number;
  column: number;
  context: 'function_call' | 'property_access' | 'identifier' | 'assignment' | 'import' | 'export';
}

export interface FileSymbolReferences {
  filename: string;
  references: SymbolReference[];
}

/**
 * Extract all symbol references from file content using OXC
 * This identifies where symbols are used, not where they're defined
 */
export function extractSymbolReferencesFromContent(
  content: string,
  filename: string,
  targetSymbols: Set<string>
): SymbolReference[] {
  const references: SymbolReference[] = [];

  try {
    const result = parseSync(filename, content, {
      sourceType: 'module',
    });

    if (!result.program) {
      return references;
    }

    // Walk the entire AST to find identifier references
    walkASTWithParent(result.program, null, (node: unknown, parent: unknown) => {
      const nodeWithType = node as { type: string; name?: string; start?: number };
      const parentNode = parent as { type?: string } | null;
      if (
        nodeWithType.type === 'Identifier' &&
        nodeWithType.name &&
        targetSymbols.has(nodeWithType.name)
      ) {
        // Skip identifiers that are definitions, not references
        if (isDefinition(nodeWithType, parentNode)) {
          return;
        }

        // Determine context based on parent node
        const context = determineIdentifierContext(nodeWithType, parentNode);

        // Convert byte position to line number
        const bytePosition = nodeWithType.start || 0;
        const line = getLineNumber(content, bytePosition);

        references.push({
          name: nodeWithType.name,
          line,
          column: getColumnNumber(content, bytePosition),
          context,
        });
      }
    });
  } catch {
    // Failed to parse file for symbol references
  }

  return references;
}

/**
 * Check if a specific line contains any target symbols by looking up precomputed references
 */
export function lineContainsAnySymbol(
  lineNumber: number,
  filename: string,
  targetSymbols: string[],
  precomputedReferences: Map<string, FileSymbolReferences>
): boolean {
  const fileRefs = precomputedReferences.get(filename);
  if (!fileRefs) {
    return false;
  }

  return fileRefs.references.some(
    (ref) => ref.line === lineNumber && targetSymbols.includes(ref.name)
  );
}

/**
 * Walk AST nodes recursively with parent tracking
 */
function walkASTWithParent(
  node: unknown,
  parent: unknown,
  callback: (node: unknown, parent: unknown) => void
) {
  if (!node || typeof node !== 'object') {
    return;
  }

  callback(node, parent);

  // Walk all properties that could contain child nodes
  for (const key in node as Record<string, unknown>) {
    const value = (node as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        walkASTWithParent(item, node, callback);
      }
    } else if (value && typeof value === 'object') {
      walkASTWithParent(value, node, callback);
    }
  }
}

/**
 * Check if an identifier is a definition rather than a reference
 */
function isDefinition(node: unknown, parent: unknown): boolean {
  const parentTyped = parent as {
    type?: string;
    id?: unknown;
    key?: unknown;
    local?: unknown;
  } | null;

  if (!parentTyped) {
    return false;
  }
  if (!parent) {
    return false;
  }

  switch (parentTyped.type) {
    // Class definitions
    case 'ClassDeclaration':
      return parentTyped.id === node;

    // Function definitions
    case 'FunctionDeclaration':
      return parentTyped.id === node;

    // Method definitions
    case 'MethodDefinition':
      return parentTyped.key === node;

    // Property definitions
    case 'PropertyDefinition':
      return parentTyped.key === node;

    // Variable declarations
    case 'VariableDeclarator':
      return parentTyped.id === node;

    // Function parameters
    case 'Parameter':
      return true;

    // Import/export specifiers - these are declarations, not references
    case 'ImportSpecifier':
    case 'ImportDefaultSpecifier':
    case 'ImportNamespaceSpecifier':
      return parentTyped.local === node;

    case 'ExportSpecifier':
      return parentTyped.local === node;

    default:
      return false;
  }
}

/**
 * Determine the context of an identifier based on its parent node
 */
function determineIdentifierContext(
  identifierNode: unknown,
  parentNode: unknown
): SymbolReference['context'] {
  const parent = parentNode as {
    type?: string;
    callee?: unknown;
    property?: unknown;
    left?: unknown;
  } | null;
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
      // Check if this is the property being accessed (obj.prop)
      if (parent.property === identifierNode) {
        return 'property_access';
      }
      // If it's the object being accessed (obj.prop), it's still a reference
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
 * Convert byte position to line number
 */
function getLineNumber(content: string, bytePosition: number): number {
  if (bytePosition === 0) {
    return 1;
  }

  const beforePosition = content.substring(0, bytePosition);
  const lines = beforePosition.split('\n');
  return lines.length;
}

/**
 * Convert byte position to column number
 */
function getColumnNumber(content: string, bytePosition: number): number {
  if (bytePosition === 0) {
    return 0;
  }

  const beforePosition = content.substring(0, bytePosition);
  const lines = beforePosition.split('\n');
  const lastLine = lines[lines.length - 1];
  return lastLine?.length || 0;
}
