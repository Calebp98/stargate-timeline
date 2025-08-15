import { promises as fs } from 'fs';
import path from 'path';

interface CachedImage {
  date: string;
  imageUrl: string;
  timestamp: number;
}

interface CacheMetadata {
  bbox: [number, number, number, number];
  images: CachedImage[];
  lastUpdated: number;
}

export class ImageCache {
  private cacheDir: string;
  private metadataFile: string;

  constructor() {
    this.cacheDir = path.join(process.cwd(), '.cache', 'satellite-images');
    this.metadataFile = path.join(this.cacheDir, 'metadata.json');
  }

  private async ensureCacheDir(): Promise<void> {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
    } catch (error) {
      console.warn('Failed to create cache directory:', error);
    }
  }

  private getCacheKey(date: string): string {
    return `${date}.png`;
  }

  private async loadMetadata(): Promise<CacheMetadata | null> {
    try {
      const data = await fs.readFile(this.metadataFile, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      return null;
    }
  }

  private async saveMetadata(metadata: CacheMetadata): Promise<void> {
    try {
      await this.ensureCacheDir();
      await fs.writeFile(this.metadataFile, JSON.stringify(metadata, null, 2));
    } catch (error) {
      console.warn('Failed to save cache metadata:', error);
    }
  }

  async getCachedImages(
    bbox: [number, number, number, number],
    startDate: string,
    endDate: string
  ): Promise<CachedImage[] | null> {
    const metadata = await this.loadMetadata();
    
    if (!metadata) {
      return null;
    }

    // Filter images within date range and load existing ones from disk
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    const validImages = [];
    for (const img of metadata.images) {
      const imgDate = new Date(img.date);
      if (imgDate >= start && imgDate <= end) {
        const cachedImageUrl = await this.getCachedImagePath(img.date);
        if (cachedImageUrl) {
          validImages.push({
            ...img,
            imageUrl: cachedImageUrl
          });
        }
      }
    }

    console.log(`Found ${validImages.length} cached images for date range`);
    return validImages.length > 0 ? validImages : null;
  }

  async cacheImage(date: string, imageData: Buffer): Promise<string> {
    try {
      await this.ensureCacheDir();
      const filename = this.getCacheKey(date);
      const filepath = path.join(this.cacheDir, filename);
      
      await fs.writeFile(filepath, imageData);
      
      // Return data URL for immediate use
      const base64 = imageData.toString('base64');
      return `data:image/png;base64,${base64}`;
    } catch (error) {
      console.warn('Failed to cache image:', error);
      throw error;
    }
  }

  async addImages(newImages: CachedImage[]): Promise<void> {
    const metadata = await this.loadMetadata() || { 
      bbox: [0, 0, 0, 0], 
      images: [], 
      lastUpdated: Date.now() 
    };

    // Add only new images (avoid duplicates by date)
    const existingDates = new Set(metadata.images.map(img => img.date));
    const imagesToAdd = newImages.filter(img => !existingDates.has(img.date));

    if (imagesToAdd.length > 0) {
      metadata.images.push(...imagesToAdd);
      metadata.lastUpdated = Date.now();
      await this.saveMetadata(metadata);
      console.log(`Added ${imagesToAdd.length} new images to repository`);
    }
  }

  async getMissingDates(startDate: string, endDate: string, intervalDays: number = 7): Promise<string[]> {
    const metadata = await this.loadMetadata();
    const existingDates = new Set(metadata?.images.map(img => img.date) || []);
    
    const missingDates = [];
    const current = new Date(startDate);
    const end = new Date(endDate);

    while (current <= end) {
      const dateStr = current.toISOString().split('T')[0];
      if (!existingDates.has(dateStr)) {
        missingDates.push(dateStr);
      }
      current.setDate(current.getDate() + intervalDays);
    }

    return missingDates;
  }

  async getCachedImagePath(date: string): Promise<string | null> {
    try {
      const filename = this.getCacheKey(date);
      const filepath = path.join(this.cacheDir, filename);
      
      // Check if file exists
      await fs.access(filepath);
      
      // Read and return as data URL
      const imageData = await fs.readFile(filepath);
      const base64 = imageData.toString('base64');
      return `data:image/png;base64,${base64}`;
    } catch (error) {
      return null;
    }
  }

  async clearCache(): Promise<void> {
    try {
      await fs.rm(this.cacheDir, { recursive: true, force: true });
      console.log('Cache cleared');
    } catch (error) {
      console.warn('Failed to clear cache:', error);
    }
  }
}