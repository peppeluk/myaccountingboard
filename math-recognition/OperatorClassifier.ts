import type { SegmentedSymbol, Features } from './types';

/**
 * OperatorClassifier - Classify mathematical operators using pattern matching
 * 
 * Recognizes: + - × ÷ = ( ) % ^
 * Uses feature extraction and heuristic matching
 */
export class OperatorClassifier {
  /**
   * Classify a segmented symbol as an operator
   * Returns operator string or empty string if unknown
   */
  static classify(segment: SegmentedSymbol): string {
    const features = this.extractFeatures(segment.canvas);

    // Try each pattern in order of confidence
    if (this.isEqualsSign(features)) return '=';
    if (this.isPlusSign(features)) return '+';
    if (this.isMinusSign(features)) return '-';
    if (this.isMultiplySign(features)) return 'x';
    if (this.isDivideSign(features)) return ':';
    if (this.isOpenParen(features)) return '(';
    if (this.isCloseParen(features)) return ')';
    if (this.isPercent(features)) return '%';
    if (this.isCaret(features)) return '^';

    // Unknown operator
    console.warn('[OperatorClassifier] Unknown operator pattern:', features);
    return '';
  }

  /**
   * Extract visual features from canvas
   */
  private static extractFeatures(canvas: HTMLCanvasElement): Features {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return this.emptyFeatures();
    }

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const { data, width, height } = imageData;

    let horizontalLines = 0;
    let verticalLines = 0;
    let totalPixels = 0;

    // Analyze horizontal lines
    for (let y = 0; y < height; y++) {
      let rowPixels = 0;
      for (let x = 0; x < width; x++) {
        const alpha = data[(y * width + x) * 4 + 3];
        if (alpha > 128) {
          rowPixels++;
          totalPixels++;
        }
      }
      if (rowPixels > width * 0.4) {
        horizontalLines++;
      }
    }

    // Analyze vertical lines
    for (let x = 0; x < width; x++) {
      let colPixels = 0;
      for (let y = 0; y < height; y++) {
        const alpha = data[(y * width + x) * 4 + 3];
        if (alpha > 128) {
          colPixels++;
        }
      }
      if (colPixels > height * 0.4) {
        verticalLines++;
      }
    }

    // Analyze diagonals
    const diagonalLines = this.countDiagonals(imageData);

    // Calculate density
    const totalArea = width * height;
    const density = totalArea > 0 ? totalPixels / totalArea : 0;

    return {
      width,
      height,
      aspectRatio: height > 0 ? width / height : 1,
      horizontalLines,
      verticalLines,
      diagonalLines,
      density
    };
  }

  /**
   * Count diagonal line segments
   */
  private static countDiagonals(imageData: ImageData): number {
    const { data, width, height } = imageData;
    let diagonalCount = 0;

    // Sample diagonal lines (top-left to bottom-right and top-right to bottom-left)
    const samples = Math.min(width, height);
    
    // Check main diagonals
    for (let i = 0; i < samples; i += 3) {
      const x1 = Math.floor((i / samples) * width);
      const y1 = Math.floor((i / samples) * height);
      
      const idx1 = (y1 * width + x1) * 4 + 3;
      if (data[idx1] > 128) diagonalCount++;

      const x2 = width - 1 - x1;
      const idx2 = (y1 * width + x2) * 4 + 3;
      if (data[idx2] > 128) diagonalCount++;
    }

    return diagonalCount;
  }

  /**
   * Pattern: Plus sign (+)
   * Features: Cross shape, both horizontal and vertical lines
   */
  private static isPlusSign(f: Features): boolean {
    return (
      f.horizontalLines >= 2 &&
      f.verticalLines >= 2 &&
      f.aspectRatio > 0.6 && f.aspectRatio < 1.4 &&
      f.density > 0.15 && f.density < 0.5
    );
  }

  /**
   * Pattern: Minus sign (-)
   * Features: Horizontal line only, wide aspect ratio
   */
  private static isMinusSign(f: Features): boolean {
    return (
      f.horizontalLines >= 2 &&
      f.verticalLines < 2 &&
      f.aspectRatio > 1.8 &&
      f.density > 0.15 && f.density < 0.6
    );
  }

  /**
   * Pattern: Multiply sign (×)
   * Features: X shape, diagonal lines
   */
  private static isMultiplySign(f: Features): boolean {
    return (
      f.diagonalLines >= 3 &&
      f.aspectRatio > 0.6 && f.aspectRatio < 1.4 &&
      f.density > 0.15 && f.density < 0.5
    );
  }

  /**
   * Pattern: Divide sign (÷ or :)
   * Features: Horizontal line with dots above/below (low density)
   */
  private static isDivideSign(f: Features): boolean {
    return (
      f.horizontalLines >= 1 &&
      f.aspectRatio > 0.8 && f.aspectRatio < 1.2 &&
      f.density > 0.1 && f.density < 0.4 // Lower density due to dots
    );
  }

  /**
   * Pattern: Equals sign (=)
   * Features: Two parallel horizontal lines
   */
  private static isEqualsSign(f: Features): boolean {
    return (
      f.horizontalLines >= 3 && // Two thick lines
      f.verticalLines < 2 &&
      f.aspectRatio > 1.5 &&
      f.density > 0.2 && f.density < 0.6
    );
  }

  /**
   * Pattern: Open parenthesis (
   * Features: Curved left-facing arc
   */
  private static isOpenParen(f: Features): boolean {
    return (
      f.verticalLines >= 3 &&
      f.horizontalLines < 3 &&
      f.aspectRatio < 0.6 &&
      f.density > 0.2 && f.density < 0.5
    );
  }

  /**
   * Pattern: Close parenthesis )
   * Features: Curved right-facing arc
   */
  private static isCloseParen(f: Features): boolean {
    return (
      f.verticalLines >= 3 &&
      f.horizontalLines < 3 &&
      f.aspectRatio < 0.6 &&
      f.density > 0.2 && f.density < 0.5
    );
  }

  /**
   * Pattern: Percent sign (%)
   * Features: Two circles with diagonal line
   */
  private static isPercent(f: Features): boolean {
    return (
      f.diagonalLines >= 2 &&
      f.aspectRatio > 0.8 && f.aspectRatio < 1.2 &&
      f.density > 0.25 && f.density < 0.6
    );
  }

  /**
   * Pattern: Caret/Power (^)
   * Features: Upward-pointing V shape
   */
  private static isCaret(f: Features): boolean {
    return (
      f.diagonalLines >= 2 &&
      f.horizontalLines < 2 &&
      f.aspectRatio > 0.7 && f.aspectRatio < 1.3 &&
      f.density < 0.4
    );
  }

  /**
   * Empty features object
   */
  private static emptyFeatures(): Features {
    return {
      width: 0,
      height: 0,
      aspectRatio: 1,
      horizontalLines: 0,
      verticalLines: 0,
      diagonalLines: 0,
      density: 0
    };
  }

  /**
   * Calculate confidence score for a classification
   */
  static calculateConfidence(features: Features, operator: string): number {
    // Simple heuristic: better features = higher confidence
    const hasExpectedShape = 
      (operator === '+' && this.isPlusSign(features)) ||
      (operator === '-' && this.isMinusSign(features)) ||
      (operator === 'x' && this.isMultiplySign(features)) ||
      (operator === ':' && this.isDivideSign(features)) ||
      (operator === '=' && this.isEqualsSign(features));

    return hasExpectedShape ? 0.8 : 0.5;
  }

  /**
   * Visualize features for debugging
   */
  static visualizeFeatures(canvas: HTMLCanvasElement): string {
    const features = this.extractFeatures(canvas);
    return `
      Size: ${features.width}x${features.height}
      Aspect: ${features.aspectRatio.toFixed(2)}
      H-Lines: ${features.horizontalLines}
      V-Lines: ${features.verticalLines}
      Diagonals: ${features.diagonalLines}
      Density: ${(features.density * 100).toFixed(1)}%
    `.trim();
  }
}
