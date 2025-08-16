import type { APIRoute } from 'astro';
import { ImageCache } from '../../lib/image-cache';

export const GET: APIRoute = async () => {
  try {
    const cache = new ImageCache();
    
    // Get current date range (same as main app)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setFullYear(endDate.getFullYear() - 1, endDate.getMonth() - 6);
    
    const bbox: [number, number, number, number] = [-99.8065975964918, 32.492551389316205, -99.7717279119445, 32.51217098523884];
    
    const startTime = Date.now();
    const cachedImages = await cache.getCachedImages(
      bbox,
      startDate.toISOString().split('T')[0],
      endDate.toISOString().split('T')[0]
    );
    const loadTime = Date.now() - startTime;
    
    return new Response(JSON.stringify({
      cacheExists: !!cachedImages,
      imageCount: cachedImages?.length || 0,
      loadTimeMs: loadTime,
      dateRange: {
        start: startDate.toISOString().split('T')[0],
        end: endDate.toISOString().split('T')[0]
      },
      bbox: bbox,
      status: cachedImages && cachedImages.length >= 5 ? 'ready' : 'empty'
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: 'Failed to check cache status',
      details: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};