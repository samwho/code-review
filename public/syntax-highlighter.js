class SyntaxHighlighter {
  constructor() {
    this.keywords = new Set([
      'abstract', 'any', 'as', 'async', 'await', 'boolean', 'break', 'case', 'catch', 'class',
      'const', 'constructor', 'continue', 'debugger', 'declare', 'default', 'delete', 'do',
      'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'from', 'function',
      'get', 'if', 'implements', 'import', 'in', 'instanceof', 'interface', 'is', 'keyof',
      'let', 'module', 'namespace', 'never', 'new', 'null', 'number', 'object', 'of',
      'package', 'private', 'protected', 'public', 'readonly', 'return', 'set', 'static',
      'string', 'super', 'switch', 'symbol', 'this', 'throw', 'true', 'try', 'type',
      'typeof', 'undefined', 'union', 'unknown', 'var', 'void', 'while', 'with', 'yield'
    ]);
    
    this.operators = new Set([
      '+', '-', '*', '/', '%', '=', '==', '===', '!=', '!==', '<', '>', '<=', '>=',
      '&&', '||', '!', '&', '|', '^', '~', '<<', '>>', '>>>', '++', '--', '+=', '-=',
      '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=', '>>>=', '=>', '?', ':', '??'
    ]);
    
    this.punctuation = new Set([
      '(', ')', '[', ']', '{', '}', ';', ',', '.', '...', '?.'
    ]);
  }

  highlight(code, language = 'typescript') {
    if (!code || typeof code !== 'string') return '';
    if (!['typescript', 'javascript', 'ts', 'js'].includes(language.toLowerCase())) {
      return this.escapeHtml(code);
    }

    const tokens = this.tokenize(code);
    return tokens.map(token => this.renderToken(token)).join('');
  }

  tokenize(code) {
    const tokens = [];
    let i = 0;
    
    while (i < code.length) {
      const char = code[i];
      
      // Skip whitespace but preserve it
      if (/\s/.test(char)) {
        const start = i;
        while (i < code.length && /\s/.test(code[i])) i++;
        tokens.push({
          type: 'whitespace',
          value: code.slice(start, i)
        });
        continue;
      }
      
      // Single line comments
      if (char === '/' && code[i + 1] === '/') {
        const start = i;
        while (i < code.length && code[i] !== '\n') i++;
        tokens.push({
          type: 'comment',
          value: code.slice(start, i)
        });
        continue;
      }
      
      // Multi line comments
      if (char === '/' && code[i + 1] === '*') {
        const start = i;
        i += 2;
        while (i < code.length - 1 && !(code[i] === '*' && code[i + 1] === '/')) i++;
        if (i < code.length - 1) i += 2;
        tokens.push({
          type: 'comment',
          value: code.slice(start, i)
        });
        continue;
      }
      
      // String literals
      if (char === '"' || char === "'" || char === '`') {
        const quote = char;
        const start = i;
        i++;
        
        while (i < code.length) {
          if (code[i] === quote && code[i - 1] !== '\\') {
            i++;
            break;
          }
          if (code[i] === '\\') i++; // Skip escaped character
          i++;
        }
        
        tokens.push({
          type: 'string',
          value: code.slice(start, i)
        });
        continue;
      }
      
      // Numbers
      if (/\d/.test(char)) {
        const start = i;
        while (i < code.length && /[\d.xboXBO]/.test(code[i])) i++;
        tokens.push({
          type: 'number',
          value: code.slice(start, i)
        });
        continue;
      }
      
      // Identifiers and keywords
      if (/[a-zA-Z_$]/.test(char)) {
        const start = i;
        while (i < code.length && /[a-zA-Z0-9_$]/.test(code[i])) i++;
        const value = code.slice(start, i);
        
        tokens.push({
          type: this.keywords.has(value) ? 'keyword' : 'identifier',
          value: value
        });
        continue;
      }
      
      // Multi-character operators
      const twoChar = code.slice(i, i + 2);
      const threeChar = code.slice(i, i + 3);
      
      if (this.operators.has(threeChar)) {
        tokens.push({
          type: 'operator',
          value: threeChar
        });
        i += 3;
        continue;
      }
      
      if (this.operators.has(twoChar)) {
        tokens.push({
          type: 'operator',
          value: twoChar
        });
        i += 2;
        continue;
      }
      
      // Single character operators and punctuation
      if (this.operators.has(char) || this.punctuation.has(char)) {
        tokens.push({
          type: this.operators.has(char) ? 'operator' : 'punctuation',
          value: char
        });
        i++;
        continue;
      }
      
      // Unknown character
      tokens.push({
        type: 'unknown',
        value: char
      });
      i++;
    }
    
    return tokens;
  }

  renderToken(token) {
    const escaped = this.escapeHtml(token.value);
    
    switch (token.type) {
      case 'keyword':
        return `<span class="syntax-keyword">${escaped}</span>`;
      case 'string':
        return `<span class="syntax-string">${escaped}</span>`;
      case 'number':
        return `<span class="syntax-number">${escaped}</span>`;
      case 'comment':
        return `<span class="syntax-comment">${escaped}</span>`;
      case 'operator':
        return `<span class="syntax-operator">${escaped}</span>`;
      case 'punctuation':
        return `<span class="syntax-punctuation">${escaped}</span>`;
      case 'identifier':
        return `<span class="syntax-identifier">${escaped}</span>`;
      case 'whitespace':
        return escaped;
      default:
        return escaped;
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}