/**
 * Static file serving for the Code Review application
 */

import { getContentTypeForExtension } from '../utils/file-utils';

export class StaticRoutes {
  /**
   * Handles static file requests
   */
  async handleStaticRequest(pathname: string): Promise<Response> {
    // Default to index.html for root
    const resolvedPathname = pathname === '/' ? '/index.html' : pathname;
    const filePath = `./public${resolvedPathname}`;

    try {
      const file = Bun.file(filePath);
      const exists = await file.exists();

      if (!exists) {
        return new Response('File not found', { status: 404 });
      }

      const contentType = getContentTypeForExtension(pathname);
      return new Response(file, {
        headers: {
          'Content-Type': contentType,
        },
      });
    } catch (_error) {
      return new Response('Internal server error', { status: 500 });
    }
  }
}
