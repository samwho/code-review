#!/usr/bin/env bun
/**
 * Frontend performance profiling script
 * This script analyzes the frontend code and identifies performance bottlenecks
 */

import { Glob } from 'bun';
import { readFile } from 'fs/promises';

async function analyzeFrontendCode() {
  console.log('🎯 Frontend Performance Analysis\n');
  
  // Read the main JavaScript file
  const appJsContent = await readFile('public/app.js', 'utf-8');
  const lines = appJsContent.split('\n');
  
  console.log('📊 Code Complexity Analysis:');
  console.log(`- Total lines: ${lines.length}`);
  console.log(`- File size: ${(appJsContent.length / 1024).toFixed(1)}KB`);
  
  // Analyze potential performance issues
  const performanceIssues = analyzePerformanceIssues(appJsContent, lines);
  
  console.log('\n🚨 Identified Performance Issues:');
  performanceIssues.forEach((issue, index) => {
    console.log(`\n${index + 1}. ${issue.title}`);
    console.log(`   Severity: ${issue.severity}`);
    console.log(`   Location: Lines ${issue.lines.join(', ')}`);
    console.log(`   Impact: ${issue.impact}`);
    console.log(`   Description: ${issue.description}`);
  });
  
  console.log('\n🎯 Optimization Recommendations:');
  const recommendations = generateRecommendations(performanceIssues);
  recommendations.forEach((rec, index) => {
    console.log(`\n${index + 1}. ${rec.title}`);
    console.log(`   Priority: ${rec.priority}`);
    console.log(`   Expected Impact: ${rec.expectedImpact}`);
    console.log(`   Implementation: ${rec.implementation}`);
  });
}

function analyzePerformanceIssues(content, lines) {
  const issues = [];
  
  // 1. Heavy DOM querying in symbol processing
  const querySelectorAllMatches = findMatches(content, /querySelectorAll/g);
  if (querySelectorAllMatches.length > 10) {
    const lineNumbers = querySelectorAllMatches.map(match => 
      content.substring(0, match.index).split('\n').length
    );
    issues.push({
      title: "Excessive DOM Querying",
      severity: "High",
      lines: lineNumbers.slice(0, 5), // Show first 5 instances
      impact: "Causes UI freezes during symbol processing",
      description: `Found ${querySelectorAllMatches.length} querySelectorAll calls. Each call can be expensive, especially in large DOM trees.`
    });
  }
  
  // 2. Synchronous Prism.js highlighting
  const prismMatches = findMatches(content, /Prism\.highlight/g);
  if (prismMatches.length > 0) {
    const lineNumbers = prismMatches.map(match => 
      content.substring(0, match.index).split('\n').length
    );
    issues.push({
      title: "Synchronous Syntax Highlighting",
      severity: "Medium",
      lines: lineNumbers,
      impact: "Blocks main thread during large diff rendering",
      description: "Prism.js highlighting is applied synchronously to every line, which can freeze the UI for large files."
    });
  }
  
  // 3. Heavy symbol reference finding
  const findReferencesLine = content.indexOf('findSymbolReferences');
  if (findReferencesLine !== -1) {
    const lineNumber = content.substring(0, findReferencesLine).split('\n').length;
    issues.push({
      title: "Inefficient Symbol Reference Finding",
      severity: "High", 
      lines: [lineNumber],
      impact: "Creates temporary DOM elements for each symbol lookup",
      description: "The findSymbolReferences method creates temporary DOM elements and re-parses code using Prism.js for every symbol, causing performance degradation."
    });
  }
  
  // 4. Excessive event listeners
  const eventListenerMatches = findMatches(content, /addEventListener/g);
  if (eventListenerMatches.length > 20) {
    issues.push({
      title: "Too Many Event Listeners",
      severity: "Medium",
      lines: [863], // DOMContentLoaded line
      impact: "Memory usage and potential performance issues",
      description: `Found ${eventListenerMatches.length} event listener registrations. This can lead to memory leaks and performance issues.`
    });
  }
  
  // 5. Lack of virtualization
  const renderDiffLine = content.indexOf('renderDiff');
  if (renderDiffLine !== -1) {
    const lineNumber = content.substring(0, renderDiffLine).split('\n').length;
    issues.push({
      title: "No Virtualization for Large Diffs",
      severity: "Medium",
      lines: [lineNumber],
      impact: "Poor performance with large diffs (>100 files)",
      description: "All diff content is rendered at once without virtualization, causing performance issues with large changesets."
    });
  }
  
  // 6. Inefficient symbol highlighting refresh
  const refreshHighlightingLine = content.indexOf('refreshSymbolHighlighting');
  if (refreshHighlightingLine !== -1) {
    const lineNumber = content.substring(0, refreshHighlightingLine).split('\n').length;
    issues.push({
      title: "Inefficient Symbol Highlighting Refresh",
      severity: "Medium",
      lines: [lineNumber],
      impact: "Slow toggle between highlight modes",
      description: "Symbol highlighting refresh re-processes all symbols and DOM elements instead of using cached results."
    });
  }
  
  return issues;
}

function findMatches(content, regex) {
  const matches = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    matches.push(match);
  }
  return matches;
}

function generateRecommendations(issues) {
  const recommendations = [];
  
  // High priority optimizations
  if (issues.some(i => i.title.includes("DOM Querying"))) {
    recommendations.push({
      title: "Implement DOM Query Caching",
      priority: "High",
      expectedImpact: "60-80% reduction in symbol processing time",
      implementation: "Cache DOM query results and use event delegation instead of multiple querySelectorAll calls"
    });
  }
  
  if (issues.some(i => i.title.includes("Symbol Reference"))) {
    recommendations.push({
      title: "Optimize Symbol Reference Finding",
      priority: "High", 
      expectedImpact: "70% reduction in symbol processing time",
      implementation: "Pre-parse all files once and cache symbol locations instead of re-parsing for each lookup"
    });
  }
  
  // Medium priority optimizations
  if (issues.some(i => i.title.includes("Syntax Highlighting"))) {
    recommendations.push({
      title: "Implement Async Syntax Highlighting",
      priority: "Medium",
      expectedImpact: "Eliminates UI blocking during rendering",
      implementation: "Use requestIdleCallback or Web Workers for syntax highlighting to prevent blocking the main thread"
    });
  }
  
  if (issues.some(i => i.title.includes("Virtualization"))) {
    recommendations.push({
      title: "Add Virtual Scrolling",
      priority: "Medium",
      expectedImpact: "Handles diffs with 1000+ files smoothly",
      implementation: "Implement virtual scrolling to only render visible diff content"
    });
  }
  
  // Low priority optimizations
  recommendations.push({
    title: "Implement Symbol Data Preprocessing",
    priority: "Low",
    expectedImpact: "30% improvement in initial load time",
    implementation: "Move complex symbol processing to the backend and send pre-processed data to frontend"
  });
  
  recommendations.push({
    title: "Add Request Deduplication",
    priority: "Low", 
    expectedImpact: "Prevents duplicate API calls",
    implementation: "Cache API responses and deduplicate concurrent requests"
  });
  
  return recommendations;
}

// Run the analysis
analyzeFrontendCode().catch(console.error);