class DiffViewer {
  constructor() {
    this.repositorySelect = document.getElementById('repository');
    this.baseBranchSelect = document.getElementById('base-branch');
    this.compareBranchSelect = document.getElementById('compare-branch');
    this.fileOrderSelect = document.getElementById('file-order');
    this.loadDiffButton = document.getElementById('load-diff');
    this.diffContainer = document.getElementById('diff-container');
    this.loading = document.getElementById('loading');
    this.themeToggle = document.getElementById('theme-toggle');
    this.highlightToggle = document.getElementById('highlight-toggle');
    
    // Highlighting settings
    this.highlightSettings = {
      functionsOnly: true, // Default to functions only
      showVariables: false
    };

    // Performance optimizations
    this.debouncedRefreshHighlighting = this.debounce(this.refreshSymbolHighlighting.bind(this), 300);
    this.domQueryCache = new Map(); // DOM query caching
    this.symbolReferences = new Map(); // Preprocessed symbol references
    this.asyncHighlightQueue = []; // Queue for async highlighting
    this.isHighlighting = false; // Prevent concurrent highlighting

    this.init();
  }

  /**
   * Debounce function to limit rapid successive calls
   */
  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  /**
   * Cached DOM query function to reduce expensive DOM operations
   */
  cachedQuerySelectorAll(selector, container = document) {
    const containerKey = container.id || container.className || 'document';
    const cacheKey = `${containerKey}-${selector}`;
    
    if (!this.domQueryCache.has(cacheKey)) {
      const elements = container.querySelectorAll(selector);
      this.domQueryCache.set(cacheKey, elements);
      
      // Clear cache after a reasonable time to prevent memory leaks
      setTimeout(() => {
        this.domQueryCache.delete(cacheKey);
      }, 30000); // 30 seconds
    }
    
    return this.domQueryCache.get(cacheKey);
  }

  /**
   * Clear DOM query cache (call when DOM structure changes significantly)
   */
  clearDOMCache() {
    this.domQueryCache.clear();
  }

  /**
   * Start async syntax highlighting process
   */
  async startAsyncHighlighting() {
    if (this.isHighlighting || this.asyncHighlightQueue.length === 0) {
      return;
    }
    
    this.isHighlighting = true;
    const startTime = performance.now();
    
    console.log(`🎨 Starting async highlighting of ${this.asyncHighlightQueue.length} lines...`);
    
    const chunkSize = 25; // Process 25 lines at a time
    const queue = [...this.asyncHighlightQueue]; // Copy queue
    this.asyncHighlightQueue = []; // Clear original queue
    
    for (let i = 0; i < queue.length; i += chunkSize) {
      const chunk = queue.slice(i, i + chunkSize);
      
      // Process chunk in next frame
      await new Promise(resolve => {
        requestIdleCallback(() => {
          this.highlightChunk(chunk);
          resolve();
        }, { timeout: 50 });
      });
    }
    
    const highlightTime = performance.now() - startTime;
    console.log(`✅ Async highlighting completed in ${highlightTime.toFixed(2)}ms`);
    
    // Apply symbol tooltips after highlighting is complete
    this.applySymbolTooltipsAsync();
    
    this.isHighlighting = false;
  }

  /**
   * Highlight a chunk of content cells
   */
  highlightChunk(contentCells) {
    contentCells.forEach(cell => {
      const language = cell.getAttribute('data-language');
      const content = cell.getAttribute('data-raw-content');
      
      if (content && language) {
        try {
          const highlighted = this.highlightWithPrism(content, language);
          cell.innerHTML = highlighted;
        } catch (error) {
          console.warn('Highlighting failed for line:', error);
          // Keep original text content on error
        }
      }
    });
  }

  /**
   * Apply symbol tooltips asynchronously after highlighting
   */
  async applySymbolTooltipsAsync() {
    try {
      if (this.symbolReferences.size === 0) {
        console.log('⚠️ No symbol references available for tooltips');
        return;
      }
      
      const startTime = performance.now();
      console.log(`🔗 Adding symbol tooltips for ${this.symbolReferences.size} symbols...`);
      
      // Process symbol tooltips in chunks to avoid blocking UI
      const fileDiffs = this.diffContainer.querySelectorAll('.file-diff');
      console.log(`📁 Found ${fileDiffs.length} file diffs to process`);
      
      for (const fileDiff of fileDiffs) {
        const filename = fileDiff.getAttribute('data-filename');
        if (!filename) {
          console.warn('⚠️ File diff missing data-filename attribute');
          continue;
        }
        
        const contentCells = fileDiff.querySelectorAll('.line-content');
        console.log(`📄 Processing ${contentCells.length} lines in ${filename}`);
        
        // Process in small chunks
        for (let i = 0; i < contentCells.length; i += 10) {
          const chunk = Array.from(contentCells).slice(i, i + 10);
          
          chunk.forEach(cell => {
            try {
              this.addOptimizedSymbolTooltips(cell, filename);
            } catch (error) {
              console.warn(`Error processing symbol tooltips for line:`, error);
            }
          });
          
          // Yield occasionally
          if (i % 50 === 0) {
            await new Promise(resolve => setTimeout(resolve, 0));
          }
        }
      }
      
      const tooltipTime = performance.now() - startTime;
      console.log(`✅ Symbol tooltips applied in ${tooltipTime.toFixed(2)}ms`);
      
    } catch (error) {
      console.error('❌ Error in applySymbolTooltipsAsync:', error);
    }
  }

  async init() {
    await this.loadBranches();
    this.repositorySelect.addEventListener('change', () => this.loadBranches());
    this.loadDiffButton.addEventListener('click', () => this.loadDiff());
    this.themeToggle.addEventListener('click', () => this.toggleTheme());
    this.highlightToggle.addEventListener('click', () => this.toggleHighlighting());
    this.initTheme();
  }

  async loadBranches() {
    try {
      const repository = this.repositorySelect.value;
      const response = await fetch(`/api/branches?repository=${encodeURIComponent(repository)}`);
      const branches = await response.json();
      
      this.populateBranchSelect(this.baseBranchSelect, branches);
      this.populateBranchSelect(this.compareBranchSelect, branches);
      
      // Set default selections
      // Base branch: prefer main, fallback to master
      if (branches.includes('main')) {
        this.baseBranchSelect.value = 'main';
      } else if (branches.includes('master')) {
        this.baseBranchSelect.value = 'master';
      }
      
      // Compare branch: select the first non-main/master branch
      const mainBranches = ['main', 'master'];
      const compareBranch = branches.find(branch => !mainBranches.includes(branch));
      if (compareBranch) {
        this.compareBranchSelect.value = compareBranch;
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
    const repository = this.repositorySelect.value;
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
      // Fetch diff
      const diffResponse = await fetch(`/api/diff?repository=${encodeURIComponent(repository)}&base=${encodeURIComponent(baseBranch)}&compare=${encodeURIComponent(compareBranch)}&order=${encodeURIComponent(order)}`);
      
      // Handle diff response
      if (!diffResponse.ok) {
        throw new Error(`HTTP ${diffResponse.status}: ${diffResponse.statusText}`);
      }
      
      const result = await diffResponse.json();
      this.renderDiff(result, order);

      
    } catch (error) {
      this.showError('Failed to load diff: ' + error.message);
    } finally {
      this.showLoading(false);
    }
  }

  renderDiff(diffResult, order = 'alphabetical') {
    const files = diffResult.files || diffResult; // Handle both old and new format
    const symbols = diffResult.symbols || [];
    const symbolReferences = diffResult.symbolReferences || [];
    
    if (files.length === 0) {
      this.diffContainer.innerHTML = '<div class="empty-state">No differences found between the selected branches.</div>';
      return;
    }

    // Store preprocessed data for fast lookups
    this.fileSymbols = symbols;
    this.currentDiffFiles = files;
    this.currentOrder = order;
    
    // Store preprocessed symbol references (eliminates expensive frontend processing)
    this.symbolReferences.clear();
    if (symbolReferences && symbolReferences.length > 0) {
      symbolReferences.forEach(symbol => {
        this.symbolReferences.set(symbol.name, symbol);
      });
      console.log(`📊 Performance: Using ${symbolReferences.length} preprocessed symbols`);
    } else {
      console.log('⚠️ No preprocessed symbol references available');
    }

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

    // Render files progressively to avoid blocking UI
    this.renderFilesProgressively(files);
  }

  /**
   * Render files progressively to avoid blocking the UI
   */
  async renderFilesProgressively(files) {
    const chunkSize = 3; // Render 3 files at a time
    const startTime = performance.now();
    
    console.log(`🚀 Starting progressive rendering of ${files.length} files...`);
    
    for (let i = 0; i < files.length; i += chunkSize) {
      const chunk = files.slice(i, i + chunkSize);
      
      // Render chunk synchronously
      chunk.forEach((file, chunkIndex) => {
        const globalIndex = i + chunkIndex + 1;
        const fileElement = this.createFileElement(file, globalIndex);
        this.diffContainer.appendChild(fileElement);
      });
      
      // Yield to browser for UI updates
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    
    const renderTime = performance.now() - startTime;
    console.log(`✅ Progressive rendering completed in ${renderTime.toFixed(2)}ms`);
    
    // Apply symbol tooltips after all files are rendered
    setTimeout(() => {
      this.applySymbolTooltipsAsync();
    }, 100); // Small delay to ensure DOM is fully updated
  }

  createFileElement(file, index) {
    const fileDiv = document.createElement('div');
    fileDiv.className = 'file-diff';
    fileDiv.setAttribute('data-filename', file.filename);

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
    
    // Apply syntax highlighting immediately for now, optimize later
    if (this.isHighlightableLanguage(language)) {
      try {
        contentCell.innerHTML = this.highlightWithPrism(line.content, language);
        // Store data for async symbol processing
        contentCell.setAttribute('data-language', language);
        contentCell.setAttribute('data-filename', filename);
        contentCell.setAttribute('data-raw-content', line.content);
      } catch (error) {
        console.warn('Syntax highlighting failed:', error);
        contentCell.textContent = line.content;
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

  highlightWithPrism(code, language) {
    if (!code || typeof code !== 'string') return this.escapeHtml(code);
    
    // Check if Prism is loaded and ready
    if (typeof window.Prism === 'undefined' || !window.Prism.languages) {
      console.warn('Prism.js not loaded, returning escaped HTML');
      return this.escapeHtml(code);
    }
    
    // Map our language names to Prism language names
    const languageMap = {
      'typescript': 'typescript',
      'javascript': 'javascript', 
      'ts': 'typescript',
      'js': 'javascript'
    };
    
    const prismLanguage = languageMap[language.toLowerCase()] || 'javascript';
    
    // Ensure the language is loaded
    if (!window.Prism.languages[prismLanguage]) {
      console.warn(`Prism language '${prismLanguage}' not loaded, returning escaped HTML`);
      return this.escapeHtml(code);
    }
    
    try {
      // Use Prism to highlight the code
      return window.Prism.highlight(code, window.Prism.languages[prismLanguage], prismLanguage);
    } catch (error) {
      console.warn('Prism highlighting failed:', error);
      return this.escapeHtml(code);
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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

  toggleHighlighting() {
    this.highlightSettings.showVariables = !this.highlightSettings.showVariables;
    this.highlightSettings.functionsOnly = !this.highlightSettings.showVariables;
    
    // Update the toggle button
    const highlightIcon = this.highlightToggle.querySelector('.highlight-icon');
    const highlightText = this.highlightToggle.querySelector('.highlight-text');
    
    if (this.highlightSettings.showVariables) {
      highlightIcon.textContent = '🔍';
      highlightText.textContent = 'All Symbols';
      this.highlightToggle.title = 'Switch to functions only';
    } else {
      highlightIcon.textContent = '🔧';
      highlightText.textContent = 'Functions Only';
      this.highlightToggle.title = 'Show variable highlighting';
    }
    
    // Re-apply highlighting without full re-render for better performance (debounced)
    this.debouncedRefreshHighlighting();
  }

  /**
   * Refresh symbol highlighting without full diff re-render (optimized)
   */
  refreshSymbolHighlighting() {
    if (!this.currentDiffFiles || this.symbolReferences.size === 0) return;
    
    const startTime = performance.now();
    
    // Clear existing symbol highlighting
    this.diffContainer.querySelectorAll('.symbol-interactive').forEach(element => {
      element.classList.remove('symbol-interactive', 'symbol-modified', 'symbol-used-in-pr');
      element.removeAttribute('data-symbol');
    });
    
    // Remove existing tooltips
    document.querySelectorAll('.symbol-tooltip').forEach(tooltip => {
      if (tooltip.parentNode) {
        tooltip.parentNode.removeChild(tooltip);
      }
    });
    
    // Clear DOM cache since we're refreshing
    this.clearDOMCache();
    
    // Re-apply symbol highlighting using optimized method
    this.applySymbolTooltipsAsync();
    
    const refreshTime = performance.now() - startTime;
    console.log(`🔄 Symbol highlighting refreshed in ${refreshTime.toFixed(2)}ms`);
  }

  /**
   * Optimized symbol tooltips using preprocessed data
   */
  addOptimizedSymbolTooltips(contentCell, currentFile) {
    if (this.symbolReferences.size === 0) {
      return;
    }

    // Use cached token query instead of creating new ones
    const tokens = contentCell.querySelectorAll('.token');
    
    tokens.forEach(token => {
      const text = token.textContent.trim();
      
      // Skip very short text or empty tokens
      if (!text || text.length < 2) return;
      
      // Check if this token text matches any of our preprocessed symbols
      const symbolInfo = this.symbolReferences.get(text);
      if (symbolInfo && symbolInfo.references.length > 0) {
        // Create relations array from preprocessed data
        const relations = [];
        
        // Add the definition
        relations.push({
          type: 'defined_in',
          file: symbolInfo.filename,
          line: symbolInfo.line,
          symbolType: symbolInfo.type,
          isExported: symbolInfo.isExported,
          className: symbolInfo.className
        });

        // Add preprocessed references
        symbolInfo.references.forEach(ref => {
          relations.push({
            type: 'used_in',
            file: ref.file,
            line: ref.line,
            context: ref.context
          });
        });
        
        this.makeSymbolInteractive(token, text, relations, symbolInfo.references);
      }
    });
  }

  addSymbolTooltips(contentCell, currentFile) {
    // Use optimized version
    this.addOptimizedSymbolTooltips(contentCell, currentFile);
  }
  
  // This method has been replaced by addOptimizedSymbolTooltips

  // Old inefficient methods removed - replaced with backend preprocessing and optimized frontend


  makeSymbolInteractive(element, symbolName, relations, usageInPR = []) {
    element.classList.add('symbol-interactive');
    element.setAttribute('data-symbol', symbolName);
    
    // Add special highlighting for modified functions or functions with usage in PR
    const hasModifiedFunction = relations.some(rel => rel.type === 'function_definition' && rel.isModified);
    const hasUsageInPR = usageInPR.length > 0;
    
    if (hasModifiedFunction) {
      element.classList.add('symbol-modified');
    } else if (hasUsageInPR) {
      element.classList.add('symbol-used-in-pr');
    }
    
    // Create tooltip
    const tooltip = document.createElement('div');
    tooltip.className = 'symbol-tooltip';
    tooltip.innerHTML = this.generateTooltipContent(symbolName, relations, usageInPR);
    
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

  generateTooltipContent(symbolName, relations, usageInPR = []) {
    // Check if this is a method (has className in the definition)
    const definitionRelation = relations.find(r => r.type === 'defined_in');
    const displayName = definitionRelation && definitionRelation.className ? 
      `${definitionRelation.className}.${symbolName}` : symbolName;
    
    let content = `<div class="tooltip-header"><strong>${displayName}</strong></div>`;
    
    if (relations.length === 0) {
      return content + '<div class="tooltip-body">No references found</div>';
    }
    
    content += '<div class="tooltip-body">';
    
    // Show symbol definition
    if (definitionRelation) {
      content += '<div class="relation-section">';
      const symbolIcon = definitionRelation.symbolType === 'class' ? '🏛️' : 
                        definitionRelation.symbolType === 'function' ? '🔧' : '📤';
      const exportBadge = definitionRelation.isExported ? ' <span class="export-badge">EXPORTED</span>' : '';
      const symbolTypeDisplay = definitionRelation.className ? 'method' : definitionRelation.symbolType;
      
      content += `<div class="relation-title">${symbolIcon} ${symbolTypeDisplay} defined in:</div>`;
      content += `<div class="relation-item" data-file="${definitionRelation.file}" data-line="${definitionRelation.line}">
        <span class="file-link">${definitionRelation.file}</span>:${definitionRelation.line}${exportBadge}
      </div>`;
      content += '</div>';
    }
    
    // Show references in other files
    const references = relations.filter(r => r.type === 'used_in');
    if (references.length > 0) {
      content += '<div class="relation-section">';
      content += '<div class="relation-title">📍 Used in this PR:</div>';
      references.forEach(ref => {
        const contextIcon = this.getContextIcon(ref.context);
        content += `<div class="relation-item" data-file="${ref.file}" data-line="${ref.line}">
          <span class="file-link">${ref.file}</span>:${ref.line} ${contextIcon}
          <div class="usage-context">${ref.context ? ref.context.replace('_', ' ') : 'usage'}</div>
        </div>`;
      });
      content += '</div>';
    }
    
    // Show usage in current PR
    if (usageInPR.length > 0) {
      content += '<div class="relation-section">';
      content += '<div class="relation-title">📍 Used in this PR:</div>';
      usageInPR.forEach(usage => {
        const contextIcon = this.getContextIcon(usage.context);
        const typeClass = usage.type === 'added' ? ' pr-usage-added' : usage.type === 'removed' ? ' pr-usage-removed' : '';
        content += `<div class="relation-item pr-usage${typeClass}" data-file="${usage.file}" data-line="${usage.line}">
          <span class="file-link">${usage.file}</span>:${usage.line} ${contextIcon}
          <div class="usage-context">${usage.context.replace('_', ' ')}</div>
          <div class="usage-preview">${usage.content}</div>
        </div>`;
      });
      content += '</div>';
    }
    
    content += '</div>';
    return content;
  }

  getContextIcon(context) {
    switch (context) {
      case 'function_call': return '📞';
      case 'property_access': return '🔗';
      case 'assignment': return '📝';
      case 'import': return '📥';
      case 'export': return '📤';
      default: return '👁️';
    }
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