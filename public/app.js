class DiffViewer {
  constructor() {
    this.baseBranchSelect = document.getElementById('base-branch');
    this.compareBranchSelect = document.getElementById('compare-branch');
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
      const response = await fetch(`/api/diff?base=${encodeURIComponent(baseBranch)}&compare=${encodeURIComponent(compareBranch)}`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const diff = await response.json();
      this.renderDiff(diff);
    } catch (error) {
      this.showError('Failed to load diff: ' + error.message);
    } finally {
      this.showLoading(false);
    }
  }

  renderDiff(files) {
    if (files.length === 0) {
      this.diffContainer.innerHTML = '<div class="empty-state">No differences found between the selected branches.</div>';
      return;
    }

    files.forEach(file => {
      const fileElement = this.createFileElement(file);
      this.diffContainer.appendChild(fileElement);
    });
  }

  createFileElement(file) {
    const fileDiv = document.createElement('div');
    fileDiv.className = 'file-diff';

    const header = document.createElement('div');
    header.className = 'file-header';
    
    let headerText = file.filename;
    if (file.oldFilename && file.oldFilename !== file.filename) {
      headerText = `${file.oldFilename} → ${file.filename}`;
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
      const row = this.createLineElement(line, language);
      table.appendChild(row);
    });

    fileDiv.appendChild(header);
    fileDiv.appendChild(table);
    
    return fileDiv;
  }

  createLineElement(line, language = 'text') {
    const row = document.createElement('tr');
    
    if (line.type === 'added') {
      row.className = 'line-added';
    } else if (line.type === 'removed') {
      row.className = 'line-removed';
    } else {
      row.className = 'line-context';
    }

    const lineNumberCell = document.createElement('td');
    lineNumberCell.className = 'line-numbers';
    
    if (line.type === 'added') {
      lineNumberCell.textContent = line.lineNumber || '';
    } else if (line.type === 'removed') {
      lineNumberCell.textContent = line.oldLineNumber || '';
    } else {
      lineNumberCell.textContent = line.lineNumber || '';
    }

    const contentCell = document.createElement('td');
    contentCell.className = 'line-content';
    
    // Apply syntax highlighting for TypeScript/JavaScript files
    if (this.isHighlightableLanguage(language)) {
      contentCell.innerHTML = this.highlighter.highlight(line.content, language);
    } else {
      contentCell.textContent = line.content;
    }

    row.appendChild(lineNumberCell);
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
}

// Initialize the app when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new DiffViewer();
});