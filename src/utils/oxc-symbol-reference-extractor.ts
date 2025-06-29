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
      sourceType: 'module'
    });

    if (!result.program) {
      return references;
    }

    // Walk the entire AST to find identifier references
    walkAST(result.program, (node: any) => {
      if (node.type === 'Identifier' && targetSymbols.has(node.name)) {
        // Determine context based on parent node
        const context = determineIdentifierContext(node, getParentNode(result.program, node));
        
        // Convert byte position to line number
        const line = getLineNumber(content, node.span?.start || 0);
        
        references.push({
          name: node.name,
          line,
          column: node.span?.start?.column || 0,
          context
        });
      }
    });

  } catch (error) {
    console.warn(`Failed to parse ${filename} for symbol references:`, error);
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

  return fileRefs.references.some(ref => 
    ref.line === lineNumber && targetSymbols.includes(ref.name)
  );
}

/**
 * Walk AST nodes recursively
 */
function walkAST(node: any, callback: (node: any) => void) {
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
function getParentNode(root: any, targetNode: any): any {
  let parent = null;
  
  walkAST(root, (node: any) => {
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
function determineIdentifierContext(identifierNode: any, parentNode: any): SymbolReference['context'] {
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
 * Convert byte position to line number
 */
function getLineNumber(content: string, bytePosition: number): number {
  if (bytePosition === 0) return 1;
  
  const beforePosition = content.substring(0, bytePosition);
  const lines = beforePosition.split('\n');
  return lines.length;
}