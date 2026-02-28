import { MathSymbol, BoundingBox, Point } from './types';

export class SymbolSegmenter {
  private minSymbolSize = 15;
  private maxSymbolSize = 60;

  segmentSymbols(canvas: HTMLCanvasElement): MathSymbol[] {
    const ctx = canvas.getContext('2d')!;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const symbols: MathSymbol[] = [];

    // Find connected components (symbols)
    const visited = new Array(canvas.width * canvas.height).fill(false);
    
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const index = y * canvas.width + x;
        
        if (!visited[index] && this.isPixelSet(imageData, x, y)) {
          const bbox = this.findBoundingBox(imageData, x, y, visited, canvas.width, canvas.height);
          
          if (this.isValidSymbol(bbox)) {
            const symbol = this.extractSymbol(imageData, bbox);
            symbols.push(symbol);
          }
        }
      }
    }

    console.log(`[SymbolSegmenter] Found ${symbols.length} symbols`);
    return symbols;
  }

  private isPixelSet(imageData: ImageData, x: number, y: number): boolean {
    const index = (y * imageData.width + x) * 4;
    return imageData.data[index + 3] > 128; // Alpha channel
  }

  private findBoundingBox(
    imageData: ImageData, 
    startX: number, 
    startY: number, 
    visited: boolean[], 
    width: number, 
    height: number
  ): BoundingBox {
    const queue: Point[] = [{ x: startX, y: startY }];
    const visitedLocal = new Set<string>();
    
    let minX = startX, maxX = startX;
    let minY = startY, maxY = startY;

    while (queue.length > 0) {
      const point = queue.shift()!;
      const key = `${point.x},${point.y}`;
      
      if (visitedLocal.has(key)) continue;
      if (point.x < 0 || point.x >= width || point.y < 0 || point.y >= height) continue;
      if (!this.isPixelSet(imageData, point.x, point.y)) continue;
      
      visitedLocal.add(key);
      const index = point.y * width + point.x;
      visited[index] = true;

      // Update bounding box
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);

      // Add neighbors
      queue.push(
        { x: point.x - 1, y: point.y },
        { x: point.x + 1, y: point.y },
        { x: point.x, y: point.y - 1 },
        { x: point.x, y: point.y + 1 }
      );
    }

    return {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1
    };
  }

  private isValidSymbol(bbox: BoundingBox): boolean {
    const size = Math.min(bbox.width, bbox.height);
    return size >= this.minSymbolSize && size <= this.maxSymbolSize;
  }

  private extractSymbol(imageData: ImageData, bbox: BoundingBox): MathSymbol {
    // Extract symbol image for recognition
    const symbolCanvas = document.createElement('canvas');
    symbolCanvas.width = bbox.width;
    symbolCanvas.height = bbox.height;
    const ctx = symbolCanvas.getContext('2d')!;

    // Copy symbol region
    const sourceData = imageData.data;
    const destData = ctx.createImageData(bbox.width, bbox.height);
    
    for (let y = 0; y < bbox.height; y++) {
      for (let x = 0; x < bbox.width; x++) {
        const sourceX = bbox.x + x;
        const sourceY = bbox.y + y;
        const sourceIndex = (sourceY * imageData.width + sourceX) * 4;
        const destIndex = (y * bbox.width + x) * 4;
        
        destData.data[destIndex] = sourceData[sourceIndex];
        destData.data[destIndex + 1] = sourceData[sourceIndex + 1];
        destData.data[destIndex + 2] = sourceData[sourceIndex + 2];
        destData.data[destIndex + 3] = sourceData[sourceIndex + 3];
      }
    }
    
    ctx.putImageData(destData, 0, 0);
    
    return {
      symbol: '', // Will be filled by recognition
      confidence: 0,
      bbox
    };
  }

  sortSymbolsLeftToRight(symbols: MathSymbol[]): MathSymbol[] {
    return symbols.sort((a, b) => a.bbox.x - b.bbox.x);
  }

  groupSymbolsByLine(symbols: MathSymbol[]): MathSymbol[][] {
    if (symbols.length === 0) return [];
    
    const lines: MathSymbol[][] = [];
    const sortedSymbols = this.sortSymbolsLeftToRight(symbols);
    
    let currentLine: MathSymbol[] = [sortedSymbols[0]];
    let lastY = sortedSymbols[0].bbox.y + sortedSymbols[0].bbox.height / 2;
    
    for (let i = 1; i < sortedSymbols.length; i++) {
      const symbol = sortedSymbols[i];
      const symbolY = symbol.bbox.y + symbol.bbox.height / 2;
      
      if (Math.abs(symbolY - lastY) > 20) { // New line
        lines.push(currentLine);
        currentLine = [symbol];
      } else {
        currentLine.push(symbol);
      }
      
      lastY = symbolY;
    }
    
    lines.push(currentLine);
    return lines;
  }
}
