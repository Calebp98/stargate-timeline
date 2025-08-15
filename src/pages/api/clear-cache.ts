import type { APIRoute } from 'astro';
import { ImageCache } from '../../lib/image-cache';

export const POST: APIRoute = async () => {
  try {
    const cache = new ImageCache();
    await cache.clearCache();
    
    return new Response(JSON.stringify({ 
      success: true,
      message: 'Cache cleared successfully'
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Failed to clear cache:', error);
    return new Response(JSON.stringify({ 
      success: false,
      error: 'Failed to clear cache'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};