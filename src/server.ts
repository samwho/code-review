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
    this.port = port || Number(process.env.PORT) || APP_CONFIG.DEFAULT_PORT;
    this.apiRoutes = new ApiRoutes();
    this.staticRoutes = new StaticRoutes();
  }

  /**
   * Starts the HTTP server
   */
  async start(): Promise<void> {
    const _server = Bun.serve({
      port: this.port,
      hostname: APP_CONFIG.HOSTNAME,
      fetch: this.handleRequest.bind(this),
    });

    console.log(`Code Review UI server running at http://${APP_CONFIG.HOSTNAME}:${this.port}`);
    console.log(
      'Available repositories: basic-typescript-api, react-components-library, backend-service-refactor, utility-library-breaking-changes'
    );
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
    } catch (error) {
      console.error('Request handling error:', error);
      return new Response('Internal server error', { status: 500 });
    }
  }
}

// Start the server if this file is run directly
if (import.meta.main) {
  const server = new CodeReviewServer();
  server.start().catch(console.error);
}
