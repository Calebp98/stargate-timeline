import type { APIRoute } from 'astro';
import { promises as fs } from 'fs';
import path from 'path';

export const GET: APIRoute = async ({ params }) => {
  try {
    const filePath = params.path;
    if (!filePath || !filePath.endsWith('.png')) {
      return new Response('Not found', { status: 404 });
    }

    const cacheDir = path.join(process.cwd(), '.cache', 'satellite-images');
    const imagePath = path.join(cacheDir, filePath);
    
    // Security check - ensure we're only serving from cache directory
    if (!imagePath.startsWith(cacheDir)) {
      return new Response('Forbidden', { status: 403 });
    }

    try {
      const imageBuffer = await fs.readFile(imagePath);
      
      return new Response(imageBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
          'Content-Length': imageBuffer.length.toString(),
        }
      });
    } catch (error) {
      return new Response('Image not found', { status: 404 });
    }
  } catch (error) {
    console.error('Error serving cached image:', error);
    return new Response('Server error', { status: 500 });
  }
};