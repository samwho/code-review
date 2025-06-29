/**
 * API route handlers for the Code Review application
 */

import { GitService } from '../git';
import { ExternalUsageDetector } from '../external-usage-detector';
import { 
  createJsonResponse, 
  createErrorResponse, 
  validateRequiredParams,
  getQueryParam 
} from '../utils/http-utils';
import type { FileOrder } from '../config';

export class ApiRoutes {
  private externalUsageDetector: ExternalUsageDetector;

  constructor() {
    this.externalUsageDetector = new ExternalUsageDetector();
  }

  /**
   * Get GitService instance for the specified repository
   */
  private getGitService(repository?: string): GitService {
    if (!repository) {
      repository = 'basic-typescript-api'; // Default repository
    }
    
    const repoPath = `/home/sam/code-review/test-repos/${repository}`;
    return new GitService(repoPath);
  }

  /**
   * Handles all API requests and routes them to appropriate handlers
   */
  async handleApiRequest(url: URL, request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return this.handleOptionsRequest();
    }

    try {
      switch (url.pathname) {
        case '/api/branches':
          return await this.handleBranchesRequest(url);
        
        case '/api/diff':
          return await this.handleDiffRequest(url);
        
        case '/api/dependencies':
          return await this.handleDependenciesRequest(url);
        
        case '/api/external-usages':
          return await this.handleExternalUsagesRequest(url);
        
        default:
          return createErrorResponse('API endpoint not found', 404);
      }
    } catch (error) {
      console.error('API Error:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      return createErrorResponse(message, 500);
    }
  }

  /**
   * Handles CORS preflight OPTIONS requests
   */
  private handleOptionsRequest(): Response {
    return new Response(null, { 
      status: 200, 
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    });
  }

  /**
   * Returns list of available Git branches
   */
  private async handleBranchesRequest(url: URL): Promise<Response> {
    const repository = getQueryParam(url, 'repository');
    const gitService = this.getGitService(repository);
    const branches = await gitService.getBranches();
    return createJsonResponse(branches);
  }

  /**
   * Returns diff between two branches with optional ordering
   */
  private async handleDiffRequest(url: URL): Promise<Response> {
    const validation = validateRequiredParams(url, ['base', 'compare']);
    
    if (!validation.isValid) {
      return createErrorResponse(
        `Missing required parameters: ${validation.missing.join(', ')}`, 
        400
      );
    }

    const repository = getQueryParam(url, 'repository');
    const baseBranch = getQueryParam(url, 'base');
    const compareBranch = getQueryParam(url, 'compare');
    const order = getQueryParam(url, 'order', 'alphabetical') as FileOrder;

    const gitService = this.getGitService(repository);
    const result = await gitService.getOrderedFiles(baseBranch, compareBranch, order);
    return createJsonResponse(result);
  }

  /**
   * Returns dependency analysis for a specific branch
   */
  private async handleDependenciesRequest(url: URL): Promise<Response> {
    const validation = validateRequiredParams(url, ['branch']);
    
    if (!validation.isValid) {
      return createErrorResponse('Branch parameter is required', 400);
    }

    const repository = getQueryParam(url, 'repository');
    const branch = getQueryParam(url, 'branch');
    const gitService = this.getGitService(repository);
    const graph = await gitService.analyzeDependencies(branch);
    
    // Convert to serializable format
    const serializedGraph = {
      nodes: Array.from(graph.nodes.entries()).map(([filename, analysis]) => ({
        filename,
        ...analysis
      })),
      edges: graph.edges
    };
    
    return createJsonResponse(serializedGraph);
  }

  /**
   * Returns external usages of symbols modified in a pull request
   */
  private async handleExternalUsagesRequest(url: URL): Promise<Response> {
    const validation = validateRequiredParams(url, ['base', 'compare']);
    
    if (!validation.isValid) {
      return createErrorResponse(
        `Missing required parameters: ${validation.missing.join(', ')}`, 
        400
      );
    }

    const repository = getQueryParam(url, 'repository');
    const baseBranch = getQueryParam(url, 'base');
    const compareBranch = getQueryParam(url, 'compare');
    const order = getQueryParam(url, 'order', 'alphabetical') as FileOrder;

    const gitService = this.getGitService(repository);
    
    // First get the diff to understand what symbols were modified
    const diffResult = await gitService.getOrderedFiles(baseBranch, compareBranch, order);
    
    if (!diffResult.symbols || diffResult.symbols.length === 0) {
      return createJsonResponse({
        affectedFiles: [],
        totalFiles: 0,
        scanDuration: 0
      });
    }

    // Find external usages of the modified symbols
    const externalUsages = await this.externalUsageDetector.findExternalUsages(diffResult.symbols);
    
    return createJsonResponse(externalUsages);
  }
}