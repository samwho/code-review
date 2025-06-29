/**
 * Main server for the Code Review application
 *
 * This server provides:
 * - API endpoints for Git operations and dependency analysis
 * - Static file serving for the web UI
 * - CORS support for cross-origin requests
 */

import { APP_CONFIG } from './config';
import { ApiRoutes } from './routes/api-routes';
import { StaticRoutes } from './routes/static-routes';

export class CodeReviewServer {
  private apiRoutes: ApiRoutes;
  private staticRoutes: StaticRoutes;
  private port: number;

  constructor(port?: number) {
    // biome-ignore lint/complexity/useLiteralKeys: TypeScript requires bracket notation for index signatures
    this.port = port || Number(process.env['PORT']) || APP_CONFIG.DEFAULT_PORT;
    this.apiRoutes = new ApiRoutes();
    this.staticRoutes = new StaticRoutes();
  }

  /**
   * Starts the HTTP server
   */
  async start(): Promise<void> {
    Bun.serve({
      port: this.port,
      hostname: APP_CONFIG.HOSTNAME,
      fetch: this.handleRequest.bind(this),
    });
  }

  /**
   * Main request handler that routes requests to appropriate handlers
   */
  private async handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);

    try {
      // Handle API routes
      if (url.pathname.startsWith('/api/')) {
        return await this.apiRoutes.handleApiRequest(url, request);
      }

      // Handle static files
      return await this.staticRoutes.handleStaticRequest(url.pathname);
    } catch {
      return new Response('Internal server error', { status: 500 });
    }
  }
}
