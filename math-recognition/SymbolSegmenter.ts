import type { Component, SegmentedSymbol, Point, Bounds } from './types';

/**
 * SymbolSegmenter - Segment canvas into individual symbols
 * 
 * Features:
 * - Connected component labeling
 * - Nearby component merging (e.g., 'i' has dot + line)
 * - Individual symbol canvas extraction
 */
export class SymbolSegmenter {
  private static readonly MIN_SEGMENT_WIDTH = 8;
  private static readonly MIN_SEGMENT_HEIGHT = 8;
  private static readonly MERGE_THRESHOLD = 15; // pixels
  private static readonly MIN_PIXELS = 5; // minimum pixels for a component

  /**
   * Segment canvas into individual symbols
   * Returns array of canvas elements, each containing one symbol
   */
  static segment(canvas: HTMLCanvasElement): SegmentedSymbol[] {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.error('[SymbolSegmenter] Cannot get canvas context');
      return [];
    }

    try {
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      // Step 1: Find connected components
      const components = this.findConnectedComponents(imageData);
      
      if (components.length === 0) {
        return [];
      }

      console.log(`[SymbolSegmenter] Found ${components.length} components`);

      // Step 2: Merge nearby components (e.g., dot and stem of 'i')
      const merged = this.mergeNearbyComponents(components);
      
      console.log(`[SymbolSegmenter] Merged into ${merged.length} symbols`);

      // Step 3: Extract individual canvases
      const symbols = merged
        .map(comp => this.extractSymbolCanvas(canvas, comp))
        .filter(symbol => 
          symbol.canvas.width >= this.MIN_SEGMENT_WIDTH &&
          symbol.canvas.height >= this.MIN_SEGMENT_HEIGHT
        );

      return symbols;
    } catch (error) {
      console.error('[SymbolSegmenter] Segmentation failed:', error);
      return [];
    }
  }

  /**
   * Find connected components using flood fill algorithm
   */
  private static findConnectedComponents(imageData: ImageData): Component[] {
    const { data, width, height } = imageData;
    const visited = new Set<number>();
    const components: Component[] = [];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const alpha = data[idx + 3];

        // Check if pixel is visible and not visited
        if (alpha > 128 && !visited.has(idx)) {
          const component = this.floodFill(data, width, height, x, y, visited);
          
          // Only keep components with enough pixels
          if (component.pixels.length >= this.MIN_PIXELS) {
            components.push(component);
          }
        }
      }
    }

    // Sort components left-to-right
    return components.sort((a, b) => a.bounds.minX - b.bounds.minX);
  }

  /**
   * Flood fill algorithm to find connected pixels
   */
  private static floodFill(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    startX: number,
    startY: number,
    visited: Set<number>
  ): Component {
    const stack: Point[] = [{ x: startX, y: startY }];
    const pixels: Point[] = [];
    
    let minX = startX;
    let maxX = startX;
    let minY = startY;
    let maxY = startY;

    while (stack.length > 0) {
      const { x, y } = stack.pop()!;
      
      // Check bounds
      if (x < 0 || x >= width || y < 0 || y >= height) {
        continue;
      }

      const idx = (y * width + x) * 4;

      // Check if already visited
      if (visited.has(idx)) {
        continue;
      }

      // Check if pixel is visible
      const alpha = data[idx + 3];
      if (alpha <= 128) {
        continue;
      }

      // Mark as visited
      visited.add(idx);
      pixels.push({ x, y });

      // Update bounds
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);

      // Add neighbors to stack (4-connectivity)
      stack.push({ x: x + 1, y });
      stack.push({ x: x - 1, y });
      stack.push({ x, y: y + 1 });
      stack.push({ x, y: y - 1 });
    }

    return {
      pixels,
      bounds: { minX, maxX, minY, maxY }
    };
  }

  /**
   * Merge nearby components (e.g., 'i' has dot + line)
   */
  private static mergeNearbyComponents(components: Component[]): Component[] {
    if (components.length === 0) return [];

    const merged: Component[] = [];
    const used = new Set<number>();

    for (let i = 0; i < components.length; i++) {
      if (used.has(i)) continue;

      const group: Component[] = [components[i]];

      // Find nearby components
      for (let j = i + 1; j < components.length; j++) {
        if (used.has(j)) continue;

        const distance = this.horizontalDistance(
          components[i].bounds,
          components[j].bounds
        );

        if (distance < this.MERGE_THRESHOLD) {
          group.push(components[j]);
          used.add(j);
        }
      }

      merged.push(this.mergeGroup(group));
      used.add(i);
    }

    return merged;
  }

  /**
   * Calculate horizontal distance between two bounds
   */
  private static horizontalDistance(a: Bounds, b: Bounds): number {
    if (a.maxX < b.minX) {
      return b.minX - a.maxX;
    }
    if (b.maxX < a.minX) {
      return a.minX - b.maxX;
    }
    return 0; // Overlapping
  }

  /**
   * Merge a group of components into one
   */
  private static mergeGroup(group: Component[]): Component {
    if (group.length === 1) {
      return group[0];
    }

    const allPixels: Point[] = [];
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const component of group) {
      allPixels.push(...component.pixels);
      minX = Math.min(minX, component.bounds.minX);
      maxX = Math.max(maxX, component.bounds.maxX);
      minY = Math.min(minY, component.bounds.minY);
      maxY = Math.max(maxY, component.bounds.maxY);
    }

    return {
      pixels: allPixels,
      bounds: { minX, maxX, minY, maxY }
    };
  }

  /**
   * Extract individual symbol canvas from source canvas
   */
  private static extractSymbolCanvas(
    sourceCanvas: HTMLCanvasElement,
    component: Component
  ): SegmentedSymbol {
    const { minX, maxX, minY, maxY } = component.bounds;
    const width = maxX - minX + 1;
    const height = maxY - minY + 1;

    // Add padding
    const padding = 4;
    const paddedWidth = width + padding * 2;
    const paddedHeight = height + padding * 2;

    // Create new canvas for this symbol
    const symbolCanvas = document.createElement('canvas');
    symbolCanvas.width = Math.max(paddedWidth, this.MIN_SEGMENT_WIDTH);
    symbolCanvas.height = Math.max(paddedHeight, this.MIN_SEGMENT_HEIGHT);

    const ctx = symbolCanvas.getContext('2d')!;
    
    // Fill with white background
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, symbolCanvas.width, symbolCanvas.height);

    // Draw the symbol with padding
    ctx.drawImage(
      sourceCanvas,
      minX, minY, width, height,
      padding, padding, width, height
    );

    return {
      canvas: symbolCanvas,
      bounds: component.bounds,
      centerX: (minX + maxX) / 2,
      centerY: (minY + maxY) / 2
    };
  }

  /**
   * Visualize segmentation for debugging
   * Draws bounding boxes around detected symbols
   */
  static visualize(
    canvas: HTMLCanvasElement,
    segments: SegmentedSymbol[]
  ): HTMLCanvasElement {
    const visualCanvas = document.createElement('canvas');
    visualCanvas.width = canvas.width;
    visualCanvas.height = canvas.height;

    const ctx = visualCanvas.getContext('2d')!;
    
    // Draw original canvas
    ctx.drawImage(canvas, 0, 0);

    // Draw bounding boxes
    ctx.strokeStyle = 'red';
    ctx.lineWidth = 2;

    for (const segment of segments) {
      const { minX, maxX, minY, maxY } = segment.bounds;
      const width = maxX - minX + 1;
      const height = maxY - minY + 1;
      
      ctx.strokeRect(minX, minY, width, height);
      
      // Draw center point
      ctx.fillStyle = 'blue';
      ctx.beginPath();
      ctx.arc(segment.centerX, segment.centerY, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    return visualCanvas;
  }
}
