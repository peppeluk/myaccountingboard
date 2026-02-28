/**
 * Type definitions for Math Recognition System
 */

/**
 * 2D point in canvas space
 */
export interface Point {
  x: number;
  y: number;
}

/**
 * Bounding box
 */
export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * Connected component (group of pixels)
 */
export interface Component {
  pixels: Point[];
  bounds: Bounds;
}

/**
 * Segmented symbol with its own canvas
 */
export interface SegmentedSymbol {
  canvas: HTMLCanvasElement;
  bounds: Bounds;
  centerX: number;
  centerY: number;
}

/**
 * Visual features extracted from canvas
 */
export interface Features {
  width: number;
  height: number;
  aspectRatio: number;
  horizontalLines: number;
  verticalLines: number;
  diagonalLines: number;
  density: number;
}

/**
 * Result of recognition operation
 */
export interface RecognitionResult {
  expression: string;
  confidence: number;
  segments: SegmentedSymbol[];
}

/**
 * Stroke data with timestamps
 */
export interface StrokeData {
  points: Point[];
  timestamps: number[];
}

/**
 * Math recognition configuration
 */
export interface MathRecognitionConfig {
  /**
   * Minimum confidence threshold (0-1)
   * Recognition below this will trigger warning
   */
  minConfidence?: number;

  /**
   * Enable debug logging
   */
  debug?: boolean;

  /**
   * Scribble detection sensitivity
   * Higher = easier to trigger scribble detection
   */
  scribbleSensitivity?: number;
}
