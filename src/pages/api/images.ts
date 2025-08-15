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
        input: ["B02", "B03", "B04"],
        output: { bands: 3 }
      };
    }
    
    function evaluatePixel(sample) {
      // Enhanced true color for better visibility in Texas terrain
      let r = sample.B04 * 3.0;
      let g = sample.B03 * 3.0; 
      let b = sample.B02 * 3.0;
      
      // Apply slight gamma correction for better contrast
      r = Math.pow(r, 0.9);
      g = Math.pow(g, 0.9);
      b = Math.pow(b, 0.9);
      
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
      const errorText = await response.text();
      console.warn(`No image found for ${date}: ${response.status} - ${errorText}`);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    return `data:image/png;base64,${base64}`;
  } catch (error) {
    console.error(`Error fetching image for ${date}:`, error);
    return null;
  }
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const { startDate, endDate, bbox } = await request.json();

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
      console.log('Search API unavailable, using dense sampling approach (every 3 days)');
      // Fallback: generate dates every 3 days for maximum coverage
      availableDates = [];
      const current = new Date(startDate);
      const end = new Date(endDate);
      
      while (current <= end) {
        availableDates.push(current.toISOString().split('T')[0]);
        current.setDate(current.getDate() + 3); // Every 3 days for dense coverage
      }
      console.log(`Generated ${availableDates.length} potential dates for dense sampling`);
    }

    // Get existing images from repository
    console.log('Checking repository for existing images...');
    const existingImages = await cache.getCachedImages(bboxCoords, startDate, endDate);
    
    // Find missing dates that need to be fetched
    const missingDates = await cache.getMissingDates(availableDates);

    const newImages = [];
    
    // Fetch missing images (limit to avoid overwhelming the API)
    const maxFetchCount = Math.min(missingDates.length, 20); // Limit to 20 images per request
    const datesToFetch = missingDates.slice(0, maxFetchCount);
    
    console.log(`Fetching ${datesToFetch.length} missing images (${missingDates.length - datesToFetch.length} remaining for future requests)`);
    
    for (const dateStr of datesToFetch) {
      console.log(`Fetching missing image for date: ${dateStr}`);
      
      try {
        const imageUrl = await getImageForDate(dateStr, bboxCoords);
        
        if (imageUrl) {
          console.log(`✓ Successfully got image for ${dateStr}`);
          
          // Store the image to disk
          if (imageUrl.startsWith('data:image/png;base64,')) {
            const base64Data = imageUrl.replace('data:image/png;base64,', '');
            const imageBuffer = Buffer.from(base64Data, 'base64');
            await cache.cacheImage(dateStr, imageBuffer);
          }
          
          newImages.push({
            date: dateStr,
            imageUrl: imageUrl,
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
      successRate: `${newImages.length}/${datesToFetch.length} images fetched successfully`
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