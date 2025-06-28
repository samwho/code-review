import { GitService } from './git';

const git = new GitService();
const PORT = process.env.PORT || 3000;

const server = Bun.serve({
  port: PORT,
  hostname: '0.0.0.0',
  async fetch(request) {
    const url = new URL(request.url);
    
    // Handle API routes
    if (url.pathname.startsWith('/api/')) {
      return handleAPI(url, request);
    }
    
    // Handle static files
    return handleStatic(url.pathname);
  },
});

async function handleAPI(url: URL, request: Request): Promise<Response> {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers });
  }

  try {
    if (url.pathname === '/api/branches') {
      const branches = await git.getBranches();
      return new Response(JSON.stringify(branches), { headers });
    }
    
    if (url.pathname === '/api/diff') {
      const baseBranch = url.searchParams.get('base');
      const compareBranch = url.searchParams.get('compare');
      const order = url.searchParams.get('order') as 'top-down' | 'bottom-up' | 'alphabetical' || 'alphabetical';
      
      if (!baseBranch || !compareBranch) {
        return new Response(
          JSON.stringify({ error: 'Both base and compare branches are required' }),
          { status: 400, headers }
        );
      }
      
      const result = await git.getOrderedFiles(baseBranch, compareBranch, order);
      return new Response(JSON.stringify(result), { headers });
    }
    
    if (url.pathname === '/api/dependencies') {
      const branch = url.searchParams.get('branch');
      
      if (!branch) {
        return new Response(
          JSON.stringify({ error: 'Branch parameter is required' }),
          { status: 400, headers }
        );
      }
      
      const graph = await git.analyzeDependencies(branch);
      
      // Convert to serializable format
      const serializable = {
        nodes: Array.from(graph.nodes.entries()).map(([filename, analysis]) => ({
          filename,
          ...analysis
        })),
        edges: graph.edges
      };
      
      return new Response(JSON.stringify(serializable), { headers });
    }
    
    return new Response(
      JSON.stringify({ error: 'API endpoint not found' }),
      { status: 404, headers }
    );
  } catch (error) {
    console.error('API Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers }
    );
  }
}

async function handleStatic(pathname: string): Promise<Response> {
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
    
    const contentType = getContentType(pathname);
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

function getContentType(pathname: string): string {
  const ext = pathname.split('.').pop()?.toLowerCase();
  
  switch (ext) {
    case 'html': return 'text/html';
    case 'css': return 'text/css';
    case 'js': return 'application/javascript';
    case 'json': return 'application/json';
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'gif': return 'image/gif';
    case 'svg': return 'image/svg+xml';
    default: return 'text/plain';
  }
}

console.log(`Code Review UI server running at http://0.0.0.0:${PORT}`);
console.log(`Available branches: ${(await git.getBranches()).join(', ')}`);