import type { APIRoute } from 'astro';
import GIFEncoder from 'gif-encoder-2';
import { Jimp } from 'jimp';
import { ImageCache } from '../../lib/image-cache';

export const POST: APIRoute = async ({ request }) => {
  try {
    const { startDate, endDate, bbox } = await request.json();

    if (!startDate || !endDate) {
      return new Response(JSON.stringify({ 
        error: 'Missing required parameters: startDate, endDate' 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const bboxCoords: [number, number, number, number] = bbox || [-99.8065975964918, 32.492551389316205, -99.7717279119445, 32.51217098523884];
    const cache = new ImageCache();

    // Get cached images
    console.log('Getting cached images for GIF generation...');
    const cachedImages = await cache.getCachedImages(bboxCoords, startDate, endDate);
    
    if (!cachedImages || cachedImages.length === 0) {
      return new Response(JSON.stringify({ 
        error: 'No images found. Please load the timeline first.' 
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log(`Creating GIF with ${cachedImages.length} frames...`);

    // Optimize for file size: smaller dimensions and fewer frames if needed
    const maxFrames = 20; // Limit frames to keep under 1MB
    const frameWidth = 320; // Smaller width for file size
    const frameHeight = 380; // Height + space for date
    
    // Select evenly distributed frames if we have too many
    let selectedImages = cachedImages;
    if (cachedImages.length > maxFrames) {
      selectedImages = [];
      const step = Math.floor(cachedImages.length / maxFrames);
      for (let i = 0; i < cachedImages.length; i += step) {
        selectedImages.push(cachedImages[i]);
        if (selectedImages.length >= maxFrames) break;
      }
    }

    // Initialize GIF encoder
    const encoder = new GIFEncoder(frameWidth, frameHeight, 'octree', true);
    encoder.start();
    encoder.setQuality(15); // Higher quality number = more compression
    encoder.setDelay(600); // 0.6 seconds per frame
    encoder.setRepeat(0); // Loop forever

    // Process each image
    for (let i = 0; i < selectedImages.length; i++) {
      const image = selectedImages[i];
      console.log(`Processing frame ${i + 1}/${selectedImages.length}: ${image.date}`);
      
      try {
        // Load image from base64
        const base64Data = image.imageUrl.replace('data:image/png;base64,', '');
        const imageBuffer = Buffer.from(base64Data, 'base64');
        
        // Create canvas with Jimp
        const canvas = new Jimp({ width: frameWidth, height: frameHeight, color: 0x000000FF });
        
        // Load and resize satellite image
        const satImage = await Jimp.fromBuffer(imageBuffer);
        const imageArea = frameHeight - 40; // Reserve 40px for date
        satImage.scaleToFit({ w: frameWidth, h: imageArea });
        
        // Center the satellite image
        const x = Math.floor((frameWidth - satImage.width) / 2);
        const y = Math.floor((imageArea - satImage.height) / 2) + 20; // 20px from top for date
        
        canvas.composite(satImage, x, y);
        
        // Skip text rendering for now to get basic GIF working
        // TODO: Add date text overlay once core functionality is working
        
        // Convert to RGBA array for GIF encoder
        const pixels = new Uint8Array(frameWidth * frameHeight * 4);
        let pixelIndex = 0;
        
        // Get raw bitmap data from Jimp
        const imageData = canvas.bitmap.data;
        
        for (let i = 0; i < imageData.length; i += 4) {
          pixels[pixelIndex++] = imageData[i];     // R
          pixels[pixelIndex++] = imageData[i + 1]; // G
          pixels[pixelIndex++] = imageData[i + 2]; // B
          pixels[pixelIndex++] = imageData[i + 3]; // A
        }
        
        encoder.addFrame(pixels);
        
      } catch (frameError) {
        console.error(`Error processing frame ${i}:`, frameError);
        continue; // Skip this frame
      }
    }

    encoder.finish();
    const gifBuffer = encoder.out.getData();
    
    console.log(`GIF generated: ${gifBuffer.length} bytes (${Math.round(gifBuffer.length / 1024)}KB)`);
    
    // Check if under 1MB
    if (gifBuffer.length > 1024 * 1024) {
      console.warn(`GIF is ${Math.round(gifBuffer.length / 1024)}KB, over 1MB limit`);
    }
    
    // Return GIF as blob
    return new Response(gifBuffer, {
      headers: {
        'Content-Type': 'image/gif',
        'Content-Length': gifBuffer.length.toString(),
        'Cache-Control': 'public, max-age=3600' // Cache for 1 hour
      }
    });

  } catch (error) {
    console.error('GIF generation error:', error);
    return new Response(JSON.stringify({ 
      error: 'Failed to generate GIF',
      details: error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};