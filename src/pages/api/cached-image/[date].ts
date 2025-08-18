import type { APIRoute } from 'astro';
import { ImageCache } from '../../../lib/image-cache';

export const GET: APIRoute = async ({ params }) => {
  try {
    const { date } = params;
    
    if (!date) {
      return new Response('Date parameter required', { status: 400 });
    }
    
    const cache = new ImageCache();
    const imageUrl = await cache.getCachedImagePath(date);
    
    if (!imageUrl) {
      return new Response('Image not found', { status: 404 });
    }
    
    // Extract base64 data and return as proper image response
    const base64Data = imageUrl.replace('data:image/png;base64,', '');
    const imageBuffer = Buffer.from(base64Data, 'base64');
    
    return new Response(imageBuffer, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
      }
    });
  } catch (error) {
    console.error('Error serving cached image:', error);
    return new Response('Internal server error', { status: 500 });
  }
};