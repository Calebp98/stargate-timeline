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

    // Sort images by date to ensure chronological order
    validImages.sort((a, b) => new Date(a.date) - new Date(b.date));
    
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

  async getMissingDates(availableDates: string[]): Promise<string[]> {
    const metadata = await this.loadMetadata();
    const existingDates = new Set(metadata?.images.map(img => img.date) || []);
    
    const missingDates = availableDates.filter(date => !existingDates.has(date));
    
    console.log(`Repository has ${existingDates.size} images, ${missingDates.length} of ${availableDates.length} available dates are missing`);
    return missingDates;
  }

  async getCachedImagePath(date: string): Promise<string | null> {
    try {
      const filename = this.getCacheKey(date);
      const filepath = path.join(this.cacheDir, filename);
      
      // Check if file exists
      await fs.access(filepath);
      
      // Read image data
      const imageData = await fs.readFile(filepath);
      
      // Skip small/corrupted images (like the 842-byte ones)
      if (imageData.length < 10000) { // 10KB minimum for a valid satellite image
        console.warn(`Skipping small cached image: ${date} (${imageData.length} bytes)`);
        // Delete the bad cached file
        try {
          await fs.unlink(filepath);
          console.log(`Deleted corrupted cache file: ${filename}`);
        } catch (e) {
          console.warn(`Failed to delete corrupted file: ${e}`);
        }
        return null;
      }
      
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