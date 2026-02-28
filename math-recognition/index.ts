/**
 * Math Recognition Module
 * 
 * Handwriting recognition system for mathematical expressions
 * with scribble-to-delete gesture support.
 * 
 * @example
 * ```tsx
 * import { useMathRecognition } from './math-recognition';
 * 
 * function MyComponent() {
 *   const mathRec = useMathRecognition();
 *   
 *   const handleRecognize = async () => {
 *     if (mathRec.isReady) {
 *       const result = await mathRec.recognize(canvas);
 *       console.log(result.expression);
 *     }
 *   };
 *   
 *   return (
 *     <button onClick={handleRecognize} disabled={!mathRec.isReady}>
 *       {mathRec.isRecognizing ? 'Recognizing...' : 'Recognize'}
 *     </button>
 *   );
 * }
 * ```
 */

// Core classes
export { MathRecognizer } from './MathRecognizer';
export { GestureDetector } from './GestureDetector';
export { SymbolSegmenter } from './SymbolSegmenter';
export { OperatorClassifier } from './OperatorClassifier';

// React hook
export { useMathRecognition } from './useMathRecognition';
export type { UseMathRecognitionReturn } from './useMathRecognition';

// Types
export type {
  Point,
  Bounds,
  Component,
  SegmentedSymbol,
  Features,
  RecognitionResult,
  StrokeData,
  MathRecognitionConfig
} from './types';
