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
            to: `${new Date(new Date(date).getTime() + 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}T23:59:59Z`
          },
          maxCloudCoverage: 30
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

    // Get existing images from repository
    console.log('Checking repository for existing images...');
    const existingImages = await cache.getCachedImages(bboxCoords, startDate, endDate);
    
    // Find missing dates that need to be fetched
    const missingDates = await cache.getMissingDates(startDate, endDate, 7);
    
    console.log(`Found ${existingImages?.length || 0} existing images, ${missingDates.length} dates missing`);

    const newImages = [];
    
    // Fetch only missing images
    for (const dateStr of missingDates) {
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
        await new Promise(resolve => setTimeout(resolve, 250));
        
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
      totalImageCount: allImages.length
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