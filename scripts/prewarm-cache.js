#!/usr/bin/env node

/**
 * Cache prewarming script for VPS deployment
 * Fetches a minimal set of images to populate the cache before the app starts
 */

import { ImageCache } from '../src/lib/image-cache.js';

const BBOX = [-99.8065975964918, 32.492551389316205, -99.7717279119445, 32.51217098523884];

async function prewarmCache() {
  console.log('🔥 Starting cache prewarming...');
  
  const cache = new ImageCache();
  
  // Check if cache already has images
  const endDate = new Date();
  const startDate = new Date();
  startDate.setFullYear(endDate.getFullYear() - 1, endDate.getMonth() - 6);
  
  const existingImages = await cache.getCachedImages(
    BBOX,
    startDate.toISOString().split('T')[0],
    endDate.toISOString().split('T')[0]
  );
  
  if (existingImages && existingImages.length >= 5) {
    console.log(`✅ Cache already has ${existingImages.length} images, skipping prewarming`);
    return;
  }
  
  console.log('📡 Making request to fetch initial images...');
  
  try {
    // Make a request to the API to populate the cache
    const response = await fetch('http://localhost:4321/api/images', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
        bbox: BBOX,
        fetchMore: false
      })
    });
    
    const data = await response.json();
    
    if (data.error) {
      console.warn('⚠️ Cache prewarming failed:', data.error);
      console.log('App will still work but may be slower on first load');
      return;
    }
    
    console.log(`✅ Cache prewarmed with ${data.totalImageCount} images`);
    console.log(`📊 Source: ${data.source}, New images: ${data.newImageCount}`);
    
  } catch (error) {
    console.warn('⚠️ Cache prewarming failed:', error.message);
    console.log('App will still work but may be slower on first load');
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  prewarmCache().catch(console.error);
}

export { prewarmCache };