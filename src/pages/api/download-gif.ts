import type { APIRoute } from 'astro';
import fs from 'fs';
import path from 'path';

export const GET: APIRoute = async ({ request }) => {
  try {
    const gifPath = path.join(process.cwd(), 'output.gif');
    
    // Check if the GIF file exists
    if (!fs.existsSync(gifPath)) {
      return new Response('GIF file not found', { 
        status: 404,
        headers: { 'Content-Type': 'text/plain' }
      });
    }

    // Read the GIF file
    const gifBuffer = fs.readFileSync(gifPath);
    
    // Get file stats for proper headers
    const stats = fs.statSync(gifPath);
    
    return new Response(gifBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'image/gif',
        'Content-Length': stats.size.toString(),
        'Content-Disposition': 'attachment; filename="stargate-timeline.gif"',
        'Cache-Control': 'public, max-age=3600'
      }
    });
  } catch (error) {
    console.error('Error serving GIF file:', error);
    return new Response('Internal server error', { 
      status: 500,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
};