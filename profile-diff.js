#!/usr/bin/env bun
/**
 * Profile script to identify performance bottlenecks in diff loading
 */

import { GitService } from './src/git.js';

async function profileDiffLoading() {
  console.log('Starting diff loading performance profiling...\n');
  
  const repoPath = '/home/sam/code-review/test-repos/backend-service-refactor';
  const gitService = new GitService(repoPath);
  
  const baseBranch = 'main';
  const compareBranch = 'feature/auth-improvements';
  const order = 'bottom-up';
  
  console.log(`Repository: ${repoPath}`);
  console.log(`Comparing: ${baseBranch}...${compareBranch}`);
  console.log(`Order: ${order}\n`);
  
  // Profile the main method
  console.log('⏱️  Profiling getOrderedFiles method...');
  const start = performance.now();
  
  const result = await gitService.getOrderedFiles(baseBranch, compareBranch, order);
  
  const end = performance.now();
  const totalTime = end - start;
  
  console.log(`\n📊 Performance Results:`);
  console.log(`- Total execution time: ${totalTime.toFixed(2)}ms`);
  console.log(`- Files processed: ${result.files.length}`);
  console.log(`- Symbols extracted: ${result.symbols?.length || 0}`);
  console.log(`- Time per file: ${(totalTime / result.files.length).toFixed(2)}ms\n`);
  
  // Show file breakdown
  if (result.files.length > 0) {
    console.log('📋 Processed files:');
    result.files.forEach((file, index) => {
      console.log(`  ${index + 1}. ${file.filename} (${file.lines.length} lines)`);
    });
  }
}

// Run with Bun's built-in profiler if --profile flag is provided
if (process.argv.includes('--profile')) {
  console.log('🔍 Running with Bun profiler enabled...\n');
  process.env.BUN_PROFILE = '1';
}

profileDiffLoading().catch(console.error);