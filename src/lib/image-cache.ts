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

  private async fileExists(date: string): Promise<boolean> {
    try {
      const filename = this.getCacheKey(date);
      const filepath = path.join(this.cacheDir, filename);
      await fs.access(filepath);
      return true;
    } catch (error) {
      return false;
    }
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
    let metadata = await this.loadMetadata();
    
    if (!metadata) {
      // Try to rebuild metadata from existing PNG files
      await this.rebuildMetadataFromFiles();
      metadata = await this.loadMetadata();
      
      if (!metadata) {
        return null;
      }
    }

    // Check if we need to rebuild metadata (if there are more PNG files than metadata entries)
    try {
      const files = await fs.readdir(this.cacheDir);
      const pngFiles = files.filter(file => file.endsWith('.png'));
      
      if (pngFiles.length > metadata.images.length + 10) { // Significant difference
        console.log(`Metadata inconsistent (${metadata.images.length} entries vs ${pngFiles.length} files), rebuilding...`);
        await this.rebuildMetadataFromFiles();
        metadata = await this.loadMetadata();
      }
    } catch (error) {
      console.warn('Failed to check cache consistency:', error);
    }

    // Filter images within date range and return static file URLs
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    const validImages = [];
    for (const img of metadata.images) {
      const imgDate = new Date(img.date);
      if (imgDate >= start && imgDate <= end) {
        // Check if file exists and return static URL
        if (await this.fileExists(img.date)) {
          validImages.push({
            ...img,
            imageUrl: `/stargate-timeline/cache/${img.date}.png` // Static file URL
          });
        }
      }
    }

    // Sort images by date to ensure chronological order
    validImages.sort((a, b) => new Date(a.date) - new Date(b.date));
    
    console.log(`Found ${validImages.length} cached images for date range (total in cache: ${metadata.images.length})`);
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
      
      // Include all images, even small ones (just log them)
      if (imageData.length < 5000) { // 5KB threshold for logging
        console.log(`Loading small cached image: ${date} (${imageData.length} bytes)`);
      }
      
      const base64 = imageData.toString('base64');
      return `data:image/png;base64,${base64}`;
    } catch (error) {
      return null;
    }
  }

  async rebuildMetadataFromFiles(): Promise<void> {
    try {
      await this.ensureCacheDir();
      const files = await fs.readdir(this.cacheDir);
      const pngFiles = files.filter(file => file.endsWith('.png'));
      
      const images = [];
      for (const file of pngFiles) {
        const date = file.replace('.png', '');
        const filepath = path.join(this.cacheDir, file);
        const stat = await fs.stat(filepath);
        
        images.push({
          date: date,
          imageUrl: `/stargate-timeline/cache/${date}.png`, // Static URL
          timestamp: stat.mtime.getTime()
        });
      }
      
      const metadata = {
        bbox: [-99.8065975964918, 32.492551389316205, -99.7717279119445, 32.51217098523884],
        images: images.sort((a, b) => new Date(a.date) - new Date(b.date)),
        lastUpdated: Date.now()
      };
      
      await this.saveMetadata(metadata);
      console.log(`Rebuilt metadata with ${images.length} images from cache files`);
    } catch (error) {
      console.warn('Failed to rebuild metadata:', error);
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