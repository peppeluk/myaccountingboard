import type { Point, Bounds } from './types';

/**
 * GestureDetector - Detect scribble-to-delete gestures
 * 
 * Features:
 * - Scribble detection based on rapid direction changes
 * - Speed-based gesture recognition
 * - Overlapping stroke detection for deletion
 */
export class GestureDetector {
  private readonly SCRIBBLE_DIRECTION_CHANGES = 5;
  private readonly SCRIBBLE_MIN_SPEED = 800; // pixels/second
  private readonly SCRIBBLE_MIN_LENGTH = 10; // minimum points

  /**
   * Detect if a stroke is a scribble gesture
   * 
   * Scribble characteristics:
   * - Rapid back-and-forth motion (5+ direction changes)
   * - High speed (800+ px/s)
   * - Minimum 10 points
   */
  detectScribble(stroke: Point[], timestamps: number[]): boolean {
    if (stroke.length < this.SCRIBBLE_MIN_LENGTH) {
      return false;
    }

    if (timestamps.length !== stroke.length) {
      console.warn('[GestureDetector] Timestamp array length mismatch');
      return false;
    }

    const directionChanges = this.countDirectionChanges(stroke);
    const speed = this.calculateSpeed(stroke, timestamps);

    const isScribble = 
      directionChanges >= this.SCRIBBLE_DIRECTION_CHANGES && 
      speed >= this.SCRIBBLE_MIN_SPEED;

    if (isScribble) {
      console.log(`[GestureDetector] Scribble detected: ${directionChanges} changes, ${speed.toFixed(0)} px/s`);
    }

    return isScribble;
  }

  /**
   * Count number of horizontal direction changes in a stroke
   */
  private countDirectionChanges(stroke: Point[]): number {
    if (stroke.length < 3) return 0;

    let changes = 0;
    let prevDirection = 0; // -1 = left, 0 = none, 1 = right

    for (let i = 1; i < stroke.length; i++) {
      const dx = stroke[i].x - stroke[i - 1].x;
      
      if (Math.abs(dx) < 2) continue; // Ignore tiny movements
      
      const currentDirection = Math.sign(dx);
      
      if (prevDirection !== 0 && currentDirection !== prevDirection) {
        changes++;
      }
      
      prevDirection = currentDirection;
    }

    return changes;
  }

  /**
   * Calculate average speed of stroke in pixels/second
   */
  private calculateSpeed(stroke: Point[], timestamps: number[]): number {
    if (stroke.length < 2) return 0;

    let totalDistance = 0;

    for (let i = 1; i < stroke.length; i++) {
      const dx = stroke[i].x - stroke[i - 1].x;
      const dy = stroke[i].y - stroke[i - 1].y;
      totalDistance += Math.sqrt(dx * dx + dy * dy);
    }

    const totalTime = (timestamps[timestamps.length - 1] - timestamps[0]) / 1000;
    
    if (totalTime <= 0) return 0;

    return totalDistance / totalTime;
  }

  /**
   * Find all strokes that overlap with the scribble gesture
   * Returns indices of overlapping strokes
   */
  findOverlappingStrokes(
    scribble: Point[],
    allStrokes: Point[][]
  ): number[] {
    const scribbleBounds = this.getBounds(scribble);
    const overlapping: number[] = [];

    for (let i = 0; i < allStrokes.length; i++) {
      const stroke = allStrokes[i];
      
      // Skip the scribble itself (if it's in the array)
      if (stroke === scribble) continue;

      const strokeBounds = this.getBounds(stroke);
      
      if (this.boundsOverlap(scribbleBounds, strokeBounds)) {
        // Additional check: do any points actually overlap?
        if (this.strokesActuallyOverlap(scribble, stroke, 20)) {
          overlapping.push(i);
        }
      }
    }

    console.log(`[GestureDetector] Found ${overlapping.length} overlapping strokes`);
    
    return overlapping;
  }

  /**
   * Get bounding box of a stroke
   */
  private getBounds(stroke: Point[]): Bounds {
    if (stroke.length === 0) {
      return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    }

    const xs = stroke.map(p => p.x);
    const ys = stroke.map(p => p.y);

    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys)
    };
  }

  /**
   * Check if two bounding boxes overlap
   */
  private boundsOverlap(a: Bounds, b: Bounds): boolean {
    return !(
      a.maxX < b.minX || 
      a.minX > b.maxX ||
      a.maxY < b.minY || 
      a.minY > b.maxY
    );
  }

  /**
   * Check if two strokes actually overlap (not just bounding boxes)
   * Uses distance threshold to detect proximity
   */
  private strokesActuallyOverlap(
    stroke1: Point[],
    stroke2: Point[],
    threshold: number
  ): boolean {
    // Sample points for performance (check every 3rd point)
    for (let i = 0; i < stroke1.length; i += 3) {
      const p1 = stroke1[i];
      
      for (let j = 0; j < stroke2.length; j += 3) {
        const p2 = stroke2[j];
        
        const dx = p1.x - p2.x;
        const dy = p1.y - p2.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance < threshold) {
          return true;
        }
      }
    }
    
    return false;
  }

  /**
   * Check if a point is near a stroke
   */
  isPointNearStroke(point: Point, stroke: Point[], threshold: number = 15): boolean {
    for (const strokePoint of stroke) {
      const dx = point.x - strokePoint.x;
      const dy = point.y - strokePoint.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance < threshold) {
        return true;
      }
    }
    
    return false;
  }
}
