#!/usr/bin/env bun
/**
 * Detailed profiling script to identify specific bottlenecks in diff loading
 */

import { GitService } from './src/git.js';

async function timeFunction(name, fn) {
  const start = performance.now();
  const result = await fn();
  const end = performance.now();
  const duration = end - start;
  console.log(`  ⏱️  ${name}: ${duration.toFixed(2)}ms`);
  return { result, duration };
}

async function detailedProfile() {
  console.log('🔍 Detailed Performance Analysis\n');
  
  const repoPath = '/home/sam/code-review/test-repos/backend-service-refactor';
  const gitService = new GitService(repoPath);
  
  const baseBranch = 'main';
  const compareBranch = 'feature/auth-improvements';
  
  console.log('📋 Individual Method Timing:');
  
  // 1. Profile getDiff
  const { result: diff, duration: diffTime } = await timeFunction(
    'getDiff()', 
    () => gitService.getDiff(baseBranch, compareBranch)
  );
  
  // 2. Profile getFilesInBranch
  const { result: allFiles, duration: filesTime } = await timeFunction(
    'getFilesInBranch()',
    () => gitService.getFilesInBranch(compareBranch)
  );
  
  // 3. Profile loadFileContents (this is likely the bottleneck)
  console.log(`\n📂 File Content Loading Analysis:`);
  console.log(`  - Total files in branch: ${allFiles.length}`);
  
  const loadStart = performance.now();
  const fileContents = new Map();
  
  for (let i = 0; i < Math.min(allFiles.length, 5); i++) {
    const file = allFiles[i];
    const fileStart = performance.now();
    try {
      const content = await gitService.getFileContents(compareBranch, file);
      fileContents.set(file, content);
      const fileEnd = performance.now();
      console.log(`    📄 ${file}: ${(fileEnd - fileStart).toFixed(2)}ms (${content.length} chars)`);
    } catch (error) {
      console.log(`    ❌ ${file}: Error - ${error.message}`);
    }
  }
  
  const loadEnd = performance.now();
  console.log(`  📊 Sample load time (5 files): ${(loadEnd - loadStart).toFixed(2)}ms`);
  console.log(`  📈 Estimated total load time: ${((loadEnd - loadStart) * allFiles.length / 5).toFixed(2)}ms`);
  
  // 4. Profile symbol extraction
  const { duration: symbolTime } = await timeFunction(
    'extractFromChangedFiles()',
    () => {
      const symbolExtractor = gitService.symbolExtractor;
      return symbolExtractor.extractFromChangedFiles(diff, compareBranch);
    }
  );
  
  console.log(`\n📊 Performance Summary:`);
  console.log(`  - Git diff: ${diffTime.toFixed(2)}ms`);
  console.log(`  - List files: ${filesTime.toFixed(2)}ms`);
  console.log(`  - Symbol extraction: ${symbolTime.toFixed(2)}ms`);
  console.log(`  - Estimated file content loading: ${((loadEnd - loadStart) * allFiles.length / 5).toFixed(2)}ms`);
  
  const estimatedTotal = diffTime + filesTime + symbolTime + ((loadEnd - loadStart) * allFiles.length / 5);
  console.log(`  - Estimated total: ${estimatedTotal.toFixed(2)}ms`);
  
  console.log(`\n🎯 Potential Optimizations:`);
  if ((loadEnd - loadStart) * allFiles.length / 5 > 100) {
    console.log(`  ⚠️  File content loading is the main bottleneck!`);
    console.log(`     - Currently loading ${allFiles.length} files sequentially`);
    console.log(`     - Average time per file: ${((loadEnd - loadStart) / 5).toFixed(2)}ms`);
    console.log(`     - Consider parallel loading or caching`);
  }
  
  if (symbolTime > 50) {
    console.log(`  ⚠️  Symbol extraction is slow`);
    console.log(`     - Consider optimizing OXC parser usage`);
  }
}

detailedProfile().catch(console.error);