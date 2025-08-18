import type { APIRoute } from 'astro';
import { ImageCache } from '../../lib/image-cache';

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

interface ProcessRequest {
  input: {
    bounds: {
      bbox: [number, number, number, number];
      properties: {
        crs: string;
      };
    };
    data: [{
      type: string;
      dataFilter: {
        timeRange: {
          from: string;
          to: string;
        };
        maxCloudCoverage?: number;
      };
    }];
  };
  output: {
    width: number;
    height: number;
    responses: {
      identifier: string;
      format: {
        type: string;
      };
    }[];
  };
  evalscript: string;
}

async function getToken(): Promise<string> {
  const response = await fetch('https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: import.meta.env.SENTINEL_CLIENT_ID,
      client_secret: import.meta.env.SENTINEL_CLIENT_SECRET,
    }),
  });

  if (!response.ok) {
    throw new Error(`Authentication failed: ${response.status} ${response.statusText}`);
  }

  const data: TokenResponse = await response.json();
  return data.access_token;
}

async function searchAvailableImages(
  bbox: [number, number, number, number], 
  startDate: string, 
  endDate: string
): Promise<string[]> {
  const token = await getToken();
  
  const searchBody = {
    collections: ["sentinel-2-l2a"],
    datetime: `${startDate}T00:00:00Z/${endDate}T23:59:59Z`,
    bbox: bbox,
    limit: 1000,
    query: {
      "eo:cloud_cover": {
        "lt": 40
      }
    }
  };

  try {
    const response = await fetch('https://sh.dataspace.copernicus.eu/api/v1/catalog/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(searchBody),
    });

    if (!response.ok) {
      console.warn(`Search failed: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const dates = data.features
      .map((feature: any) => feature.properties.datetime.split('T')[0])
      .sort()
      .filter((date: string, index: number, array: string[]) => array.indexOf(date) === index); // Remove duplicates

    console.log(`Found ${dates.length} available images with <30% cloud cover`);
    return dates;
  } catch (error) {
    console.error('Error searching for available images:', error);
    return [];
  }
}

async function getImageForDate(date: string, bbox: [number, number, number, number]): Promise<string | null> {
  const token = await getToken();
  
  const evalscript = `
    //VERSION=3
    function setup() {
      return {
        input: ["B02", "B03", "B04", "CLM"],
        output: { bands: 3 }
      };
    }
    
    function evaluatePixel(sample) {
      // Check for clouds/invalid data
      if (sample.CLM == 1) {
        return [0.5, 0.5, 0.5]; // Gray for clouds
      }
      
      // True color RGB
      let r = sample.B04; // Red
      let g = sample.B03; // Green  
      let b = sample.B02; // Blue
      
      // Check for no-data/black pixels
      if (r + g + b < 0.001) {
        return [0.1, 0.1, 0.1]; // Very dark gray instead of pure black
      }
      
      // Enhanced contrast for better visibility
      r = Math.min(1, r * 2.5);
      g = Math.min(1, g * 2.5);
      b = Math.min(1, b * 2.5);
      
      // Apply gamma correction for better contrast
      r = Math.pow(r, 0.8);
      g = Math.pow(g, 0.8);
      b = Math.pow(b, 0.8);
      
      return [r, g, b];
    }
  `;

  const requestBody: ProcessRequest = {
    input: {
      bounds: {
        bbox: bbox,
        properties: {
          crs: "http://www.opengis.net/def/crs/EPSG/0/4326"
        }
      },
      data: [{
        type: "sentinel-2-l2a",
        dataFilter: {
          timeRange: {
            from: `${date}T00:00:00Z`,
            to: `${date}T23:59:59Z`
          },
          maxCloudCoverage: 40
        }
      }]
    },
    output: {
      width: 512,
      height: 512,
      responses: [{
        identifier: "default",
        format: {
          type: "image/png"
        }
      }]
    },
    evalscript: evalscript
  };

  try {
    const response = await fetch('https://sh.dataspace.copernicus.eu/api/v1/process', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      // Skip fallback for dates that are likely to have no data (future dates, etc.)
      const requestDate = new Date(date);
      const now = new Date();
      const daysDifference = (requestDate - now) / (1000 * 60 * 60 * 24);
      
      if (daysDifference > -60) { // Only try fallback for dates within last 60 days
        console.warn(`Primary request failed for ${date}: ${response.status}, trying fallback...`);
      
      // Try with a simpler evalscript
      const fallbackEvalscript = `
        //VERSION=3
        function setup() {
          return {
            input: ["B04", "B03", "B02"],
            output: { bands: 3 }
          };
        }
        
        function evaluatePixel(sample) {
          return [sample.B04 * 2.5, sample.B03 * 2.5, sample.B02 * 2.5];
        }
      `;
      
      const fallbackRequest = {
        ...requestBody,
        evalscript: fallbackEvalscript
      };
      
      const fallbackResponse = await fetch('https://sh.dataspace.copernicus.eu/api/v1/process', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(fallbackRequest),
      });
      
      if (!fallbackResponse.ok) {
        const errorText = await fallbackResponse.text();
        console.warn(`Fallback also failed for ${date}: ${fallbackResponse.status} - ${errorText}`);
        return null;
      }
      
      const fallbackArrayBuffer = await fallbackResponse.arrayBuffer();
      
      // Validate fallback image
      if (fallbackArrayBuffer.byteLength < 1000) {
        console.warn(`Fallback image too small for ${date}: ${fallbackArrayBuffer.byteLength} bytes`);
        return null;
      }
      
      const fallbackBase64 = Buffer.from(fallbackArrayBuffer).toString('base64');
      return `data:image/png;base64,${fallbackBase64}`;
      } else {
        console.warn(`No image available for ${date}: ${response.status}`);
        return null;
      }
    }

    const arrayBuffer = await response.arrayBuffer();
    
    // Validate image data
    if (arrayBuffer.byteLength < 10000) { // Increase threshold to 10KB
      console.warn(`Image too small for ${date}: ${arrayBuffer.byteLength} bytes`);
      return null;
    }
    
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    
    // Basic validation - check if it looks like a PNG
    const pngHeader = Buffer.from(arrayBuffer.slice(0, 8));
    const expectedPngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    
    if (!pngHeader.equals(expectedPngHeader)) {
      console.warn(`Invalid PNG header for ${date}`);
      return null;
    }
    
    return `data:image/png;base64,${base64}`;
  } catch (error) {
    console.error(`Error fetching image for ${date}:`, error);
    return null;
  }
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const { startDate, endDate, bbox, fetchMore = false } = await request.json();

    console.log('API called with params:', { startDate, endDate, bbox });
    console.log('Environment check:', {
      hasClientId: !!import.meta.env.SENTINEL_CLIENT_ID,
      hasClientSecret: !!import.meta.env.SENTINEL_CLIENT_SECRET
    });

    if (!startDate || !endDate) {
      return new Response(JSON.stringify({ 
        error: 'Missing required parameters: startDate, endDate',
        received: { startDate, endDate, bbox }
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const bboxCoords: [number, number, number, number] = bbox || [-121.2, 37.7, -121.1, 37.8];
    const cache = new ImageCache();

    // Try to search for available images, fall back to dense sampling if search fails
    console.log('Searching for available images with <30% cloud cover...');
    let availableDates = await searchAvailableImages(bboxCoords, startDate, endDate);
    
    if (availableDates.length === 0) {
      console.log('Search API unavailable, using intelligent sampling approach');
      // Fallback: generate dates with intelligent intervals
      availableDates = [];
      const current = new Date(startDate);
      const end = new Date(endDate);
      const now = new Date();
      
      while (current <= end) {
        const dateStr = current.toISOString().split('T')[0];
        const daysDifference = (current - now) / (1000 * 60 * 60 * 24);
        
        // Skip future dates beyond a reasonable satellite data range
        if (daysDifference <= 7) {
          availableDates.push(dateStr);
        }
        
        // Use different intervals based on how recent the date is
        if (daysDifference > -30) {
          current.setDate(current.getDate() + 7); // Weekly for recent dates
        } else if (daysDifference > -180) {
          current.setDate(current.getDate() + 14); // Bi-weekly for older dates
        } else {
          current.setDate(current.getDate() + 30); // Monthly for very old dates
        }
      }
      console.log(`Generated ${availableDates.length} potential dates using intelligent sampling`);
    }

    // Get existing images from repository
    console.log('Checking repository for existing images...');
    const startTime = Date.now();
    const existingImages = await cache.getCachedImages(bboxCoords, startDate, endDate);
    const cacheLoadTime = Date.now() - startTime;
    console.log(`Cache load took ${cacheLoadTime}ms`);
    
    // If we have cached images, return them immediately (lower threshold for better UX)
    if (existingImages && existingImages.length >= 5 && !fetchMore) {
      console.log(`Returning ${existingImages.length} cached images without fetching new ones (cache load: ${cacheLoadTime}ms)`);
      return new Response(JSON.stringify({ 
        images: existingImages,
        source: 'repository',
        newImageCount: 0,
        totalImageCount: existingImages.length,
        availableImageCount: availableDates.length,
        remainingToFetch: 0,
        cloudCoverThreshold: 40,
        successRate: "N/A - using cached images",
        cacheLoadTimeMs: cacheLoadTime
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Only fetch new images if we have very few cached ones
    const missingDates = await cache.getMissingDates(availableDates);
    const newImages = [];
    
    // Fetch missing images (limit to avoid overwhelming the API)
    const maxFetchCount = Math.min(missingDates.length, 5); // Reduce to just 5 per request
    const datesToFetch = missingDates.slice(0, maxFetchCount);
    
    console.log(`Fetching ${datesToFetch.length} missing images (${missingDates.length - datesToFetch.length} remaining for future requests)`);
    
    for (const dateStr of datesToFetch) {
      console.log(`Fetching missing image for date: ${dateStr}`);
      
      try {
        const imageUrl = await getImageForDate(dateStr, bboxCoords);
        
        if (imageUrl) {
          console.log(`✓ Successfully got image for ${dateStr}`);
          
          // Store the image to disk with validation
          if (imageUrl.startsWith('data:image/png;base64,')) {
            const base64Data = imageUrl.replace('data:image/png;base64,', '');
            const imageBuffer = Buffer.from(base64Data, 'base64');
            
            // Additional validation before caching (keep strict for new images)
            if (imageBuffer.length > 10000) { // Keep 10KB minimum for new images
              try {
                await cache.cacheImage(dateStr, imageBuffer);
              } catch (error) {
                console.warn(`Failed to cache image for ${dateStr}:`, error);
                continue; // Skip this image
              }
            } else {
              console.warn(`Skipping small/invalid image for ${dateStr}: ${imageBuffer.length} bytes`);
              continue;
            }
          }
          
          newImages.push({
            date: dateStr,
            imageUrl: `/stargate-timeline/cache/${dateStr}.png`, // Static URL  
            timestamp: Date.now()
          });
        } else {
          console.log(`✗ No image found for ${dateStr}`);
        }
        
        // Add delay between requests to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error) {
        console.log(`✗ Error fetching image for ${dateStr}:`, error);
      }
    }

    // Add new images to repository
    if (newImages.length > 0) {
      await cache.addImages(newImages);
    }

    // Get all images (existing + new) for the date range
    const allImages = await cache.getCachedImages(bboxCoords, startDate, endDate) || [];
    
    console.log(`Returning ${allImages.length} total images (${newImages.length} newly fetched)`);

    return new Response(JSON.stringify({ 
      images: allImages,
      source: newImages.length > 0 ? 'mixed' : 'repository',
      newImageCount: newImages.length,
      totalImageCount: allImages.length,
      availableImageCount: availableDates.length,
      remainingToFetch: missingDates.length - datesToFetch.length,
      cloudCoverThreshold: 40,
      successRate: `${newImages.length}/${datesToFetch.length} images fetched successfully`,
      cacheLoadTimeMs: cacheLoadTime
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error in images endpoint:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch images' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};