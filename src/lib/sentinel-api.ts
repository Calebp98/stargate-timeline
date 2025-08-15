import { SentinelAuth } from './sentinel-auth';

export interface ImageData {
  date: string;
  imageUrl: string;
  cloudCoverage?: number;
}

interface ProcessRequest {
  input: {
    bounds: {
      bbox: [number, number, number, number];
      properties: {
        crs: string;
      };
    };
    data: {
      type: string;
      dataFilter: {
        timeRange: {
          from: string;
          to: string;
        };
        maxCloudCoverage?: number;
      };
    };
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

export class SentinelAPI {
  private auth: SentinelAuth;
  private baseUrl = 'https://sh.dataspace.copernicus.eu';

  constructor() {
    this.auth = new SentinelAuth();
  }

  async getImageForDate(
    date: string,
    bbox: [number, number, number, number] = [-121.2, 37.7, -121.1, 37.8] // Default to San Francisco area
  ): Promise<string | null> {
    const token = await this.auth.getToken();
    
    const evalscript = `
      //VERSION=3
      function setup() {
        return {
          input: ["B04", "B03", "B02"],
          output: { bands: 3 }
        };
      }
      function evaluatePixel(sample) {
        return [sample.B04, sample.B03, sample.B02];
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
        data: {
          type: "sentinel-2-l2a",
          dataFilter: {
            timeRange: {
              from: `${date}T00:00:00Z`,
              to: `${date}T23:59:59Z`
            },
            maxCloudCoverage: 30
          }
        }
      },
      output: {
        width: 512,
        height: 512,
        responses: [{
          identifier: "default",
          format: {
            type: "image/jpeg"
          }
        }]
      },
      evalscript: evalscript
    };

    try {
      const response = await fetch(`${this.baseUrl}/api/v1/process`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        console.warn(`No image found for ${date}: ${response.status}`);
        return null;
      }

      const blob = await response.blob();
      return URL.createObjectURL(blob);
    } catch (error) {
      console.error(`Error fetching image for ${date}:`, error);
      return null;
    }
  }

  async getImagesForTimeRange(
    startDate: string,
    endDate: string,
    bbox: [number, number, number, number] = [-121.2, 37.7, -121.1, 37.8]
  ): Promise<ImageData[]> {
    const images: ImageData[] = [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    const current = new Date(start);

    while (current <= end) {
      const dateStr = current.toISOString().split('T')[0];
      const imageUrl = await this.getImageForDate(dateStr, bbox);
      
      if (imageUrl) {
        images.push({
          date: dateStr,
          imageUrl: imageUrl
        });
      }

      current.setDate(current.getDate() + 14);
    }

    return images;
  }
}