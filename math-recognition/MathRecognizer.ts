import * as tf from '@tensorflow/tfjs';
import { SymbolSegmenter } from './SymbolSegmenter';
import { OperatorClassifier } from './OperatorClassifier';
import type { RecognitionResult, SegmentedSymbol } from './types';

/**
 * MathRecognizer - Core handwriting math recognition using TensorFlow.js
 * 
 * Features:
 * - Digit recognition using pre-trained MNIST model
 * - Operator classification using pattern matching
 * - Expression normalization using existing normalizeOcrChunk
 */
export class MathRecognizer {
  private digitModel: tf.LayersModel | null = null;
  private isModelLoaded: boolean = false;
  private isInitializing: boolean = false;

  /**
   * Initialize the recognizer by loading the MNIST model
   * Call this before using recognize()
   */
  async initialize(): Promise<boolean> {
    if (this.isModelLoaded) {
      return true;
    }

    if (this.isInitializing) {
      // Wait for existing initialization
      while (this.isInitializing) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return this.isModelLoaded;
    }

    this.isInitializing = true;

    try {
      console.log('[MathRecognizer] Loading MNIST model...');
      
      // Load pre-trained MNIST model from TensorFlow.js hub
      this.digitModel = await tf.loadLayersModel(
        'https://storage.googleapis.com/tfjs-models/tfjs/mnist_cnn/model.json'
      );
      
      this.isModelLoaded = true;
      console.log('[MathRecognizer] Model loaded successfully');
      
      return true;
    } catch (error) {
      console.error('[MathRecognizer] Failed to load model:', error);
      this.isModelLoaded = false;
      return false;
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Recognize mathematical expression from canvas
   * Returns normalized expression string ready for calculation
   */
  async recognizeExpression(canvas: HTMLCanvasElement): Promise<RecognitionResult> {
    if (!this.isModelLoaded || !this.digitModel) {
      throw new Error('Model not loaded. Call initialize() first.');
    }

    const startTime = performance.now();

    try {
      // Step 1: Segment canvas into individual symbols
      console.log('[MathRecognizer] Segmenting symbols...');
      const segments = SymbolSegmenter.segment(canvas);
      
      if (segments.length === 0) {
        return {
          expression: '',
          confidence: 0,
          segments: []
        };
      }

      console.log(`[MathRecognizer] Found ${segments.length} segments`);

      // Step 2: Classify each segment
      const symbols: string[] = [];
      const confidences: number[] = [];

      for (const segment of segments) {
        const classification = await this.classifySegment(segment);
        symbols.push(classification.symbol);
        confidences.push(classification.confidence);
      }

      // Step 3: Join and normalize expression
      const rawExpression = symbols.join('');
      const normalizedExpression = this.normalizeExpression(rawExpression);

      // Calculate overall confidence
      const avgConfidence = confidences.reduce((a, b) => a + b, 0) / confidences.length;

      const elapsedTime = performance.now() - startTime;
      console.log(`[MathRecognizer] Recognition completed in ${elapsedTime.toFixed(0)}ms`);
      console.log(`[MathRecognizer] Result: "${normalizedExpression}" (confidence: ${(avgConfidence * 100).toFixed(1)}%)`);

      return {
        expression: normalizedExpression,
        confidence: avgConfidence,
        segments
      };
    } catch (error) {
      console.error('[MathRecognizer] Recognition failed:', error);
      throw error;
    }
  }

  /**
   * Classify a single segment as digit or operator
   */
  private async classifySegment(segment: SegmentedSymbol): Promise<{ symbol: string; confidence: number }> {
    // Determine if segment is likely a digit or operator based on aspect ratio
    const aspectRatio = segment.canvas.width / segment.canvas.height;
    
    // Digits tend to be taller (aspectRatio < 1), operators wider
    if (aspectRatio < 1.5 && this.looksLikeDigit(segment)) {
      const digit = await this.recognizeDigit(segment.canvas);
      return {
        symbol: String(digit.value),
        confidence: digit.confidence
      };
    } else {
      const operator = OperatorClassifier.classify(segment);
      return {
        symbol: operator || '',
        confidence: operator ? 0.8 : 0.3 // Lower confidence for unknown operators
      };
    }
  }

  /**
   * Check if segment looks like a digit based on features
   */
  private looksLikeDigit(segment: SegmentedSymbol): boolean {
    const { width, height } = segment.canvas;
    
    // Digits have certain characteristics:
    // - Aspect ratio between 0.4 and 1.2
    // - Reasonable size
    const aspectRatio = width / height;
    
    return aspectRatio > 0.4 && 
           aspectRatio < 1.2 && 
           width >= 10 && 
           height >= 15;
  }

  /**
   * Recognize a single digit using MNIST model
   */
  private async recognizeDigit(canvas: HTMLCanvasElement): Promise<{ value: number; confidence: number }> {
    // Preprocess canvas for MNIST model (28x28 grayscale)
    const tensor = tf.browser.fromPixels(canvas, 1)
      .resizeNearestNeighbor([28, 28])
      .expandDims(0)
      .div(255.0);

    try {
      // Get predictions
      const prediction = this.digitModel!.predict(tensor) as tf.Tensor;
      const probabilities = await prediction.data();
      
      // Find digit with highest probability
      const maxProbIdx = prediction.argMax(-1).dataSync()[0];
      const confidence = probabilities[maxProbIdx];

      // Clean up tensors
      tensor.dispose();
      prediction.dispose();

      return {
        value: maxProbIdx,
        confidence
      };
    } catch (error) {
      tensor.dispose();
      throw error;
    }
  }

  /**
   * Normalize expression using existing logic
   * This matches the normalizeOcrChunk function from App.tsx
   */
  private normalizeExpression(input: string): string {
    // First normalize operators (like existing normalizeOcrOperators)
    const withNormalizedOps = input
      .replace(/[‐‑‒–—−﹣_~]/g, "-")
      .replace(/[＋﹢]/g, "+")
      .replace(/[×✕✖＊⋅·•*]/g, "x")
      .replace(/[÷／]/g, ":")
      .replace(/([0-9)%])([tT†┼╋])(?=[0-9(])/g, "$1+")
      .replace(/([0-9)%])([;])(?=[0-9(])/g, "$1:")
      .replace(/([0-9)%])([xX])(?=[0-9(])/g, "$1x")
      .replace(/([0-9)%])([:/])(?=[0-9(])/g, "$1:");

    // Then normalize the rest (like existing normalizeOcrChunk)
    return withNormalizedOps
      .replace(/\s+/g, "")
      .replace(/(\d),(\d)/g, "$1.$2")
      .replace(/[^\d+\-x:().%^=]/g, "")
      .replace(/\+{2,}/g, "+")
      .replace(/x{2,}/g, "x")
      .replace(/:{2,}/g, ":")
      .trim();
  }

  /**
   * Calculate confidence score for multiple segments
   */
  private calculateConfidence(segments: SegmentedSymbol[]): number {
    // Simple heuristic: more segments = lower confidence
    if (segments.length === 0) return 0;
    if (segments.length === 1) return 0.9;
    if (segments.length <= 5) return 0.8;
    if (segments.length <= 10) return 0.7;
    return 0.6;
  }

  /**
   * Dispose of model and free memory
   */
  dispose(): void {
    if (this.digitModel) {
      console.log('[MathRecognizer] Disposing model');
      this.digitModel.dispose();
      this.digitModel = null;
      this.isModelLoaded = false;
    }
  }
}
