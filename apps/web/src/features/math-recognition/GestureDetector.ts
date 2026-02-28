import { Point, GesturePath } from './types';

export class GestureDetector {
  private gesturePaths: GesturePath[] = [];
  private currentPath: Point[] = [];
  private isDrawing = false;

  constructor() {
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Mouse events
    document.addEventListener('mousedown', this.handleMouseDown.bind(this));
    document.addEventListener('mousemove', this.handleMouseMove.bind(this));
    document.addEventListener('mouseup', this.handleMouseUp.bind(this));

    // Touch events
    document.addEventListener('touchstart', this.handleTouchStart.bind(this));
    document.addEventListener('touchmove', this.handleTouchMove.bind(this));
    document.addEventListener('touchend', this.handleTouchEnd.bind(this));
  }

  private handleMouseDown(event: MouseEvent): void {
    this.startDrawing({ x: event.clientX, y: event.clientY });
  }

  private handleMouseMove(event: MouseEvent): void {
    if (this.isDrawing) {
      this.addPoint({ x: event.clientX, y: event.clientY });
    }
  }

  private handleMouseUp(): void {
    this.endDrawing();
  }

  private handleTouchStart(event: TouchEvent): void {
    if (event.touches.length > 0) {
      const touch = event.touches[0];
      this.startDrawing({ x: touch.clientX, y: touch.clientY });
    }
  }

  private handleTouchMove(event: TouchEvent): void {
    if (this.isDrawing && event.touches.length > 0) {
      const touch = event.touches[0];
      this.addPoint({ x: touch.clientX, y: touch.clientY });
    }
  }

  private handleTouchEnd(): void {
    this.endDrawing();
  }

  private startDrawing(point: Point): void {
    this.isDrawing = true;
    this.currentPath = [point];
  }

  private addPoint(point: Point): void {
    if (this.currentPath.length > 0) {
      const lastPoint = this.currentPath[this.currentPath.length - 1];
      const distance = Math.sqrt(
        Math.pow(point.x - lastPoint.x, 2) + Math.pow(point.y - lastPoint.y, 2)
      );
      
      // Only add point if it's far enough from last one
      if (distance > 2) {
        this.currentPath.push(point);
      }
    }
  }

  private endDrawing(): void {
    if (this.isDrawing && this.currentPath.length > 3) {
      this.gesturePaths.push({
        points: [...this.currentPath],
        timestamp: Date.now()
      });
      
      console.log(`[GestureDetector] New gesture: ${this.currentPath.length} points`);
    }

    this.isDrawing = false;
    this.currentPath = [];
  }

  isScribbleGesture(path: Point[]): boolean {
    if (path.length < 5) return false;

    // Check if gesture looks like a scribble (random motion)
    let totalDistance = 0;
    let directionChanges = 0;
    let lastDirection = 0;

    for (let i = 1; i < path.length; i++) {
      const dx = path[i].x - path[i - 1].x;
      const dy = path[i].y - path[i - 1].y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      totalDistance += distance;

      const direction = Math.atan2(dy, dx);
      if (i > 1) {
        const directionDiff = Math.abs(direction - lastDirection);
        if (directionDiff > Math.PI / 4) {
          directionChanges++;
        }
      }
      lastDirection = direction;
    }

    // Scribble if many direction changes and reasonable distance
    const avgSegmentLength = totalDistance / path.length;
    const isScribble = directionChanges > path.length * 0.3 && avgSegmentLength < 20;

    console.log(`[GestureDetector] Scribble analysis: ${isScribble ? 'DELETE' : 'KEEP'} (direction changes: ${directionChanges})`);
    return isScribble;
  }

  getLastGesture(): GesturePath | null {
    return this.gesturePaths.length > 0 ? this.gesturePaths[this.gesturePaths.length - 1] : null;
  }

  clearGestures(): void {
    this.gesturePaths = [];
    this.currentPath = [];
    console.log('[GestureDetector] All gestures cleared');
  }

  destroy(): void {
    // Remove event listeners
    document.removeEventListener('mousedown', this.handleMouseDown.bind(this));
    document.removeEventListener('mousemove', this.handleMouseMove.bind(this));
    document.removeEventListener('mouseup', this.handleMouseUp.bind(this));
    document.removeEventListener('touchstart', this.handleTouchStart.bind(this));
    document.removeEventListener('touchmove', this.handleTouchMove.bind(this));
    document.removeEventListener('touchend', this.handleTouchEnd.bind(this));
  }
}
