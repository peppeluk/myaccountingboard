import { useCallback, useEffect, useRef, useState } from 'react';
import { MathRecognizer } from './MathRecognizer';
import { GestureDetector } from './GestureDetector';
import type { Point, RecognitionResult } from './types';

/**
 * React hook for math handwriting recognition
 * 
 * Usage:
 * ```tsx
 * const mathRec = useMathRecognition();
 * 
 * if (mathRec.isReady) {
 *   const result = await mathRec.recognize(canvas);
 *   console.log(result.expression);
 * }
 * ```
 */
export function useMathRecognition() {
  const [isReady, setIsReady] = useState(false);
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const recognizerRef = useRef<MathRecognizer | null>(null);
  const gestureDetectorRef = useRef<GestureDetector>(new GestureDetector());

  /**
   * Initialize recognizer on mount
   */
  useEffect(() => {
    const recognizer = new MathRecognizer();
    recognizerRef.current = recognizer;

    console.log('[useMathRecognition] Initializing...');

    recognizer.initialize()
      .then(success => {
        setIsReady(success);
        
        if (success) {
          console.log('[useMathRecognition] Ready');
        } else {
          const errMsg = 'Failed to initialize math recognition';
          console.error(`[useMathRecognition] ${errMsg}`);
          setError(errMsg);
        }
      })
      .catch(err => {
        console.error('[useMathRecognition] Initialization error:', err);
        setError(err.message || 'Initialization failed');
        setIsReady(false);
      });

    // Cleanup on unmount
    return () => {
      console.log('[useMathRecognition] Cleaning up');
      recognizer.dispose();
      recognizerRef.current = null;
    };
  }, []);

  /**
   * Recognize mathematical expression from canvas
   */
  const recognize = useCallback(async (
    canvas: HTMLCanvasElement
  ): Promise<RecognitionResult> => {
    if (!isReady || !recognizerRef.current) {
      throw new Error('Math recognizer not ready');
    }

    setIsRecognizing(true);
    setError(null);

    try {
      const result = await recognizerRef.current.recognizeExpression(canvas);
      
      // Log warning if confidence is low
      if (result.confidence < 0.6) {
        console.warn(
          `[useMathRecognition] Low confidence: ${(result.confidence * 100).toFixed(0)}%`
        );
      }

      return result;
    } catch (err) {
      const error = err as Error;
      console.error('[useMathRecognition] Recognition failed:', error);
      setError(error.message || 'Recognition failed');
      throw error;
    } finally {
      setIsRecognizing(false);
    }
  }, [isReady]);

  /**
   * Detect if stroke is a scribble gesture
   */
  const detectScribble = useCallback((
    stroke: Point[],
    timestamps: number[]
  ): boolean => {
    try {
      return gestureDetectorRef.current.detectScribble(stroke, timestamps);
    } catch (err) {
      console.error('[useMathRecognition] Gesture detection failed:', err);
      return false;
    }
  }, []);

  /**
   * Find strokes overlapping with scribble
   */
  const findOverlappingStrokes = useCallback((
    scribble: Point[],
    allStrokes: Point[][]
  ): number[] => {
    try {
      return gestureDetectorRef.current.findOverlappingStrokes(scribble, allStrokes);
    } catch (err) {
      console.error('[useMathRecognition] Overlap detection failed:', err);
      return [];
    }
  }, []);

  /**
   * Reset error state
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    /**
     * True when recognizer is loaded and ready to use
     */
    isReady,

    /**
     * True when recognition is in progress
     */
    isRecognizing,

    /**
     * Error message if initialization or recognition failed
     */
    error,

    /**
     * Recognize math expression from canvas
     */
    recognize,

    /**
     * Detect scribble-to-delete gesture
     */
    detectScribble,

    /**
     * Find strokes that overlap with scribble
     */
    findOverlappingStrokes,

    /**
     * Clear error state
     */
    clearError
  };
}

/**
 * Type of the hook return value
 */
export type UseMathRecognitionReturn = ReturnType<typeof useMathRecognition>;
