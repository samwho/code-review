class DiffViewer {
  constructor() {
    this.baseBranchSelect = document.getElementById('base-branch');
    this.compareBranchSelect = document.getElementById('compare-branch');
    this.fileOrderSelect = document.getElementById('file-order');
    this.loadDiffButton = document.getElementById('load-diff');
    this.diffContainer = document.getElementById('diff-container');
    this.loading = document.getElementById('loading');
    this.themeToggle = document.getElementById('theme-toggle');
    this.highlighter = new SyntaxHighlighter();

    this.init();
  }

  async init() {
    await this.loadBranches();
    this.loadDiffButton.addEventListener('click', () => this.loadDiff());
    this.themeToggle.addEventListener('click', () => this.toggleTheme());
    this.initTheme();
  }

  async loadBranches() {
    try {
      const response = await fetch('/api/branches');
      const branches = await response.json();
      
      this.populateBranchSelect(this.baseBranchSelect, branches);
      this.populateBranchSelect(this.compareBranchSelect, branches);
      
      // Set default selections
      if (branches.includes('master')) {
        this.baseBranchSelect.value = 'master';
      }
      if (branches.includes('feature/improvements')) {
        this.compareBranchSelect.value = 'feature/improvements';
      }
    } catch (error) {
      this.showError('Failed to load branches: ' + error.message);
    }
  }

  populateBranchSelect(select, branches) {
    select.innerHTML = '';
    branches.forEach(branch => {
      const option = document.createElement('option');
      option.value = branch;
      option.textContent = branch;
      select.appendChild(option);
    });
  }

  async loadDiff() {
    const baseBranch = this.baseBranchSelect.value;
    const compareBranch = this.compareBranchSelect.value;
    const order = this.fileOrderSelect.value;
    
    if (!baseBranch || !compareBranch) {
      this.showError('Please select both base and compare branches');
      return;
    }

    if (baseBranch === compareBranch) {
      this.showError('Base and compare branches cannot be the same');
      return;
    }

    this.showLoading(true);
    this.diffContainer.innerHTML = '';

    try {
      const response = await fetch(`/api/diff?base=${encodeURIComponent(baseBranch)}&compare=${encodeURIComponent(compareBranch)}&order=${encodeURIComponent(order)}`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      const files = result.files || result; // Handle both old and new format
      const graph = result.graph;
      this.renderDiff(files, order, graph);
    } catch (error) {
      this.showError('Failed to load diff: ' + error.message);
    } finally {
      this.showLoading(false);
    }
  }

  renderDiff(files, order = 'alphabetical', graph = null) {
    if (files.length === 0) {
      this.diffContainer.innerHTML = '<div class="empty-state">No differences found between the selected branches.</div>';
      return;
    }

    // Store graph for symbol relationship lookups
    this.dependencyGraph = graph;

    // Add ordering info header
    if (order !== 'alphabetical') {
      const orderInfo = document.createElement('div');
      orderInfo.className = 'order-info';
      orderInfo.innerHTML = `
        <div class="order-badge">
          📊 Files ordered by: <strong>${order === 'top-down' ? 'High-level First' : 'Dependencies First'}</strong>
          <span class="order-description">
            ${order === 'top-down' 
              ? 'Review high-level files first, then their dependencies' 
              : 'Review foundational files first, then their dependents'
            }
          </span>
        </div>
      `;
      this.diffContainer.appendChild(orderInfo);
    }

    files.forEach((file, index) => {
      const fileElement = this.createFileElement(file, index + 1);
      this.diffContainer.appendChild(fileElement);
    });
  }

  createFileElement(file, index) {
    const fileDiv = document.createElement('div');
    fileDiv.className = 'file-diff';

    const header = document.createElement('div');
    header.className = 'file-header';
    
    let headerText = file.filename;
    if (file.oldFilename && file.oldFilename !== file.filename) {
      headerText = `${file.oldFilename} → ${file.filename}`;
    }
    
    // Add file order number if provided
    if (index) {
      headerText = `${index}. ${headerText}`;
    }
    
    header.textContent = headerText;
    
    if (file.isNew) {
      const status = document.createElement('span');
      status.className = 'file-status new';
      status.textContent = 'NEW';
      header.appendChild(status);
    } else if (file.isDeleted) {
      const status = document.createElement('span');
      status.className = 'file-status deleted';
      status.textContent = 'DELETED';
      header.appendChild(status);
    }

    const table = document.createElement('table');
    table.className = 'diff-table';

    const language = this.detectLanguage(file.filename);
    file.lines.forEach(line => {
      const row = this.createLineElement(line, language, file.filename);
      table.appendChild(row);
    });

    fileDiv.appendChild(header);
    fileDiv.appendChild(table);
    
    return fileDiv;
  }

  createLineElement(line, language = 'text', filename = '') {
    const row = document.createElement('tr');
    
    // Handle hunk headers specially
    if (line.isHunkHeader) {
      row.className = 'hunk-header';
      const headerCell = document.createElement('td');
      headerCell.colSpan = 3;
      headerCell.className = 'hunk-header-content';
      headerCell.textContent = line.content;
      row.appendChild(headerCell);
      return row;
    }
    
    if (line.type === 'added') {
      row.className = 'line-added';
    } else if (line.type === 'removed') {
      row.className = 'line-removed';
    } else {
      row.className = 'line-context';
    }

    // Old line number cell
    const oldLineNumberCell = document.createElement('td');
    oldLineNumberCell.className = 'line-numbers old-line-number';
    
    // New line number cell
    const newLineNumberCell = document.createElement('td');
    newLineNumberCell.className = 'line-numbers new-line-number';
    
    // Set line numbers based on line type
    if (line.type === 'added') {
      oldLineNumberCell.textContent = '';
      newLineNumberCell.textContent = line.lineNumber || '';
    } else if (line.type === 'removed') {
      oldLineNumberCell.textContent = line.oldLineNumber || '';
      newLineNumberCell.textContent = '';
    } else {
      oldLineNumberCell.textContent = line.oldLineNumber || '';
      newLineNumberCell.textContent = line.lineNumber || '';
    }

    const contentCell = document.createElement('td');
    contentCell.className = 'line-content';
    
    // Apply syntax highlighting for TypeScript/JavaScript files
    if (this.isHighlightableLanguage(language)) {
      contentCell.innerHTML = this.highlighter.highlight(line.content, language);
      // Add hover tooltips for symbols if we have dependency graph
      if (this.dependencyGraph) {
        this.addSymbolTooltips(contentCell, filename);
      }
    } else {
      contentCell.textContent = line.content;
    }

    row.appendChild(oldLineNumberCell);
    row.appendChild(newLineNumberCell);
    row.appendChild(contentCell);
    
    return row;
  }

  detectLanguage(filename) {
    const ext = filename.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'ts':
        return 'typescript';
      case 'js':
      case 'jsx':
        return 'javascript';
      case 'tsx':
        return 'typescript';
      default:
        return 'text';
    }
  }

  isHighlightableLanguage(language) {
    return ['typescript', 'javascript', 'ts', 'js'].includes(language.toLowerCase());
  }

  showLoading(show) {
    this.loading.style.display = show ? 'block' : 'none';
  }

  showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error';
    errorDiv.textContent = message;
    
    this.diffContainer.innerHTML = '';
    this.diffContainer.appendChild(errorDiv);
  }

  initTheme() {
    // Check for saved theme preference or default to light mode
    const savedTheme = localStorage.getItem('theme') || 'light';
    this.setTheme(savedTheme);
  }

  toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    this.setTheme(newTheme);
  }

  setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    
    // Update the theme toggle icon
    const themeIcon = this.themeToggle.querySelector('.theme-icon');
    themeIcon.textContent = theme === 'dark' ? '☀️' : '🌙';
    this.themeToggle.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  }

  addSymbolTooltips(contentCell, currentFile) {
    // Find all identifier elements in the syntax-highlighted content
    const identifiers = contentCell.querySelectorAll('.syntax-identifier');
    
    identifiers.forEach(identifier => {
      const symbolName = identifier.textContent.trim();
      if (symbolName && symbolName.length > 1) {
        const relations = this.findSymbolRelations(symbolName, currentFile);
        if (relations.length > 0) {
          this.makeSymbolInteractive(identifier, symbolName, relations);
        }
      }
    });
  }

  findSymbolRelations(symbolName, currentFile) {
    if (!this.dependencyGraph || !this.dependencyGraph.nodes) {
      return [];
    }

    const relations = [];
    
    // Find where this symbol is exported from
    for (const node of this.dependencyGraph.nodes) {
      if (node.filename !== currentFile) {
        // Check exports
        const exportMatch = node.exports.find(exp => exp.name === symbolName);
        if (exportMatch) {
          relations.push({
            type: 'exported_from',
            file: node.filename,
            kind: exportMatch.kind,
            line: exportMatch.line
          });
        }
        
        // Check imports
        const importMatch = node.imports.find(imp => 
          imp.imports.some(i => i.name === symbolName || i.alias === symbolName)
        );
        if (importMatch) {
          relations.push({
            type: 'imported_in',
            file: node.filename,
            source: importMatch.source,
            line: importMatch.line
          });
        }
      }
    }

    return relations;
  }

  makeSymbolInteractive(element, symbolName, relations) {
    element.classList.add('symbol-interactive');
    element.setAttribute('data-symbol', symbolName);
    
    // Create tooltip
    const tooltip = document.createElement('div');
    tooltip.className = 'symbol-tooltip';
    tooltip.innerHTML = this.generateTooltipContent(symbolName, relations);
    
    let hideTimeout;
    let isTooltipVisible = false;
    
    // Desktop hover behavior
    element.addEventListener('mouseenter', (e) => {
      if (!('ontouchstart' in window)) { // Desktop only
        clearTimeout(hideTimeout);
        document.body.appendChild(tooltip);
        this.positionTooltip(tooltip, e.target);
        tooltip.style.display = 'block';
        isTooltipVisible = true;
      }
    });
    
    element.addEventListener('mouseleave', () => {
      if (!('ontouchstart' in window)) { // Desktop only
        hideTimeout = setTimeout(() => {
          if (tooltip.parentNode) {
            tooltip.parentNode.removeChild(tooltip);
            isTooltipVisible = false;
          }
        }, 200);
      }
    });
    
    // Mobile/touch behavior
    element.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      if (!isTooltipVisible) {
        // Show tooltip
        document.body.appendChild(tooltip);
        this.positionTooltip(tooltip, e.target);
        tooltip.style.display = 'block';
        isTooltipVisible = true;
        
        // Hide other tooltips
        document.querySelectorAll('.symbol-tooltip').forEach(t => {
          if (t !== tooltip && t.parentNode) {
            t.parentNode.removeChild(t);
          }
        });
      }
    });
    
    // Hide tooltip when clicking outside (mobile)
    document.addEventListener('click', (e) => {
      if (isTooltipVisible && !tooltip.contains(e.target) && !element.contains(e.target)) {
        if (tooltip.parentNode) {
          tooltip.parentNode.removeChild(tooltip);
          isTooltipVisible = false;
        }
      }
    });
    
    // Keep tooltip open when hovering over it (desktop)
    tooltip.addEventListener('mouseenter', () => {
      if (!('ontouchstart' in window)) {
        clearTimeout(hideTimeout);
      }
    });
    
    tooltip.addEventListener('mouseleave', () => {
      if (!('ontouchstart' in window)) {
        hideTimeout = setTimeout(() => {
          if (tooltip.parentNode) {
            tooltip.parentNode.removeChild(tooltip);
            isTooltipVisible = false;
          }
        }, 200);
      }
    });

    // Add click handlers for file navigation
    tooltip.addEventListener('click', (e) => {
      const relationItem = e.target.closest('.relation-item');
      if (relationItem) {
        const targetFile = relationItem.getAttribute('data-file');
        const targetLine = relationItem.getAttribute('data-line');
        this.navigateToFile(targetFile, targetLine);
        
        // Close tooltip
        if (tooltip.parentNode) {
          tooltip.parentNode.removeChild(tooltip);
          isTooltipVisible = false;
        }
      }
    });
  }

  generateTooltipContent(symbolName, relations) {
    let content = `<div class="tooltip-header"><strong>${symbolName}</strong></div>`;
    
    if (relations.length === 0) {
      return content + '<div class="tooltip-body">No cross-file references found</div>';
    }
    
    content += '<div class="tooltip-body">';
    
    const exported = relations.filter(r => r.type === 'exported_from');
    const imported = relations.filter(r => r.type === 'imported_in');
    
    if (exported.length > 0) {
      content += '<div class="relation-section">';
      content += '<div class="relation-title">📤 Exported from:</div>';
      exported.forEach(rel => {
        content += `<div class="relation-item" data-file="${rel.file}" data-line="${rel.line}">
          <span class="file-link">${rel.file}</span>:${rel.line} 
          <span class="symbol-kind">${rel.kind}</span>
        </div>`;
      });
      content += '</div>';
    }
    
    if (imported.length > 0) {
      content += '<div class="relation-section">';
      content += '<div class="relation-title">📥 Used in:</div>';
      imported.forEach(rel => {
        content += `<div class="relation-item" data-file="${rel.file}" data-line="${rel.line}">
          <span class="file-link">${rel.file}</span>:${rel.line}
        </div>`;
      });
      content += '</div>';
    }
    
    content += '</div>';
    return content;
  }

  positionTooltip(tooltip, target) {
    const rect = target.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
    
    tooltip.style.position = 'absolute';
    tooltip.style.left = (rect.left + scrollLeft) + 'px';
    tooltip.style.top = (rect.bottom + scrollTop + 5) + 'px';
    tooltip.style.zIndex = '1000';
  }

  navigateToFile(targetFile, targetLine) {
    // Find the file diff element
    const fileDiffs = this.diffContainer.querySelectorAll('.file-diff');
    
    for (const fileDiff of fileDiffs) {
      const header = fileDiff.querySelector('.file-header');
      if (header && header.textContent.includes(targetFile)) {
        // Scroll to the file
        fileDiff.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'start' 
        });
        
        // Highlight the file briefly
        fileDiff.classList.add('file-highlighted');
        setTimeout(() => {
          fileDiff.classList.remove('file-highlighted');
        }, 2000);
        
        // If we have a specific line, try to find and highlight it
        if (targetLine) {
          setTimeout(() => {
            const lineNumbers = fileDiff.querySelectorAll('.line-numbers');
            for (const lineNumber of lineNumbers) {
              const lineText = lineNumber.textContent.trim().replace(/^[+-]/, ''); // Remove prefix
              if (lineText === targetLine.toString()) {
                const row = lineNumber.closest('tr');
                if (row) {
                  row.scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'center' 
                  });
                  row.classList.add('line-highlighted');
                  setTimeout(() => {
                    row.classList.remove('line-highlighted');
                  }, 3000);
                }
                break;
              }
            }
          }, 500);
        }
        
        break;
      }
    }
  }
}

// Initialize the app when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new DiffViewer();
});