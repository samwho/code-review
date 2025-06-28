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
    if (pathname === '/') {
      pathname = '/index.html';
    }
    
    const filePath = `./public${pathname}`;
    
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
    } catch (error) {
      console.error('Static file error:', error);
      return new Response('Internal server error', { status: 500 });
    }
  }
}