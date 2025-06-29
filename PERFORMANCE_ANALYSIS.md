# Performance Analysis - Diff Loading

## Overview
Performance profiling conducted on diff loading operations to identify bottlenecks and optimization opportunities.

## Profiling Method
- Used Bun's built-in profiler with `--smol --profile` flags
- Tested multiple diff requests across different repositories
- Analyzed code paths in GitService and SimpleSymbolExtractor

## Major Performance Bottlenecks

### 1. **Symbol Extraction (Primary Bottleneck)**
- **Location**: `src/simple-symbol-extractor.ts:154-301`
- **Impact**: High - Dominates response time
- **Issue**: 
  - Creates new ts-morph `SourceFile` instance for each changed file
  - Performs full AST parsing on every file in diff
  - Extracts all symbols (classes, functions, interfaces, etc.) synchronously
  - No efficient caching of parse results
- **Files Affected**: Every file in every diff request

### 2. **Git Operations (Secondary Bottleneck)**
- **Location**: `src/git.ts:90-101` and `src/simple-symbol-extractor.ts:318-320`
- **Impact**: Medium - Accumulates across multiple files
- **Issue**:
  - Multiple individual `git show` calls for file content
  - Sequential git operations instead of batched
  - `getDiff()` + individual file content retrieval
- **Files Affected**: One git call per changed file

### 3. **Dependency Analysis (Conditional Bottleneck)**
- **Location**: `src/git.ts:119-129` (when using top-down/bottom-up ordering)
- **Impact**: Medium-High when used
- **Issue**:
  - Builds complete dependency graph just for file ordering
  - Runs full TypeScript analysis on entire codebase
  - Only used for non-alphabetical ordering

## Performance Test Results
- **Repository**: basic-typescript-api (master...feature/improvements)
- **Files Changed**: 10 files
- **Response Pattern**: 
  - Initial request: Slow (no cache)
  - Subsequent identical requests: Faster (some caching)
  - Different branch comparisons: Slow again

## Optimization Recommendations

### **High Impact (Implement First)**

#### 1. **Lazy Symbol Loading**
- **Effort**: Medium
- **Impact**: Very High
- **Approach**: 
  - Return file diffs immediately
  - Load symbols on-demand when user views specific files
  - Implement progressive enhancement in UI

#### 2. **Enhanced Caching Strategy**
- **Effort**: Low-Medium  
- **Impact**: High
- **Approach**:
  - Expand existing content-hash caching
  - Add request-level caching for identical branch comparisons
  - Implement ETag headers for HTTP caching

#### 3. **Batch Git Operations**
- **Effort**: Low
- **Impact**: Medium-High
- **Approach**:
  - Single `git show` command for multiple files
  - Parallelize independent git operations
  - Cache git results within request lifecycle

### **Medium Impact**

#### 4. **Optimize TypeScript Parsing**
- **Effort**: Medium-High
- **Impact**: Medium
- **Approach**:
  - Reuse ts-morph Project instances
  - Use targeted AST traversal instead of full parsing
  - Consider alternative parsers (swc, esbuild)

#### 5. **Smart Dependency Analysis**
- **Effort**: Medium
- **Impact**: Medium (when dependency ordering used)
- **Approach**:
  - Cache dependency graphs
  - Use incremental analysis
  - Limit scope to changed files only

### **Lower Priority**

#### 6. **Background Processing**
- **Effort**: High
- **Impact**: Medium
- **Approach**:
  - Pre-compute common branch comparisons
  - Background symbol extraction
  - WebSocket updates for progressive loading

## Implementation Priority

1. **Lazy Symbol Loading** - Biggest immediate improvement
2. **Enhanced Caching** - Low effort, high reward  
3. **Batch Git Operations** - Quick wins
4. **TypeScript Parser Optimization** - Longer term effort

## Files Requiring Changes

- `src/git.ts` - Main entry point optimization
- `src/simple-symbol-extractor.ts` - Core bottleneck fixes
- `src/routes/api-routes.ts` - Lazy loading API changes
- `public/app.js` - UI changes for progressive loading

## Metrics to Track

- **Time to First Byte (TTFB)**: Target < 200ms for file list
- **Symbol Loading Time**: Target < 500ms per file
- **Cache Hit Rate**: Target > 80% for repeated requests
- **Memory Usage**: Monitor ts-morph memory consumption

---

**Analysis Date**: 2025-06-29  
**Profiling Tool**: Bun Inspector + Manual Code Review  
**Test Environment**: Local development server