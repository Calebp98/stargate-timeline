#!/usr/bin/env node

/**
 * Cache prewarming script for VPS deployment
 * Makes HTTP requests to populate the cache before the app starts serving users
 */

const BBOX = [-99.8065975964918, 32.492551389316205, -99.7717279119445, 32.51217098523884];

async function prewarmCache() {
  console.log('🔥 Starting cache prewarming...');
  
  // Calculate date range (same as main app)
  const endDate = new Date();
  const startDate = new Date();
  startDate.setFullYear(endDate.getFullYear() - 1, endDate.getMonth() - 6);
  
  console.log('📡 Checking cache status...');
  
  try {
    // Check current cache status
    const statusResponse = await fetch('http://localhost:4321/api/cache-status');
    const status = await statusResponse.json();
    
    console.log(`Cache status: ${status.status}, ${status.imageCount} images`);
    
    if (status.imageCount >= 5) {
      console.log(`✅ Cache already has ${status.imageCount} images, skipping prewarming`);
      return;
    }
    
    console.log('📡 Making request to populate cache...');
    
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
prewarmCache().catch(console.error);