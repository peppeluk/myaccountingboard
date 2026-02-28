import { useCallback, useEffect, useRef, useState } from 'react';
import { MathRecognizer } from './MathRecognizer';
import { GestureDetector } from './GestureDetector';
import { SymbolSegmenter } from './SymbolSegmenter';
import { OperatorClassifier } from './OperatorClassifier';
import { RecognitionResult } from './types';

export function useMathRecognition() {
  const [isReady, setIsReady] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastResult, setLastResult] = useState<RecognitionResult | null>(null);
  
  const recognizerRef = useRef<MathRecognizer | null>(null);
  const detectorRef = useRef<GestureDetector | null>(null);
  const segmenterRef = useRef<SymbolSegmenter | null>(null);
  const classifierRef = useRef<OperatorClassifier | null>(null);

  useEffect(() => {
    // Initialize all components
    recognizerRef.current = new MathRecognizer();
    detectorRef.current = new GestureDetector();
    segmenterRef.current = new SymbolSegmenter();
    classifierRef.current = new OperatorClassifier();

    // Check readiness
    const checkReady = () => {
      if (recognizerRef.current?.ready) {
        setIsReady(true);
        console.log('[useMathRecognition] Math recognition system ready');
      } else {
        setTimeout(checkReady, 500);
      }
    };

    checkReady();

    return () => {
      // Cleanup
      detectorRef.current?.destroy();
    };
  }, []);

  const recognize = useCallback(async (canvas: HTMLCanvasElement): Promise<RecognitionResult> => {
    if (!recognizerRef.current || !detectorRef.current || !segmenterRef.current || !classifierRef.current) {
      throw new Error('Math recognition components not initialized');
    }

    setIsProcessing(true);
    
    try {
      console.log('[useMathRecognition] Starting recognition...');
      
      // Step 1: Check for delete gesture
      const lastGesture = detectorRef.current.getLastGesture();
      if (lastGesture && detectorRef.current.isScribbleGesture(lastGesture.points)) {
        console.log('[useMathRecognition] Delete gesture detected');
        return {
          expression: 'DELETE',
          confidence: 0.9,
          symbols: [],
          processingTime: 0
        };
      }

      // Step 2: Segment symbols
      const symbols = segmenterRef.current.segmentSymbols(canvas);
      if (symbols.length === 0) {
        throw new Error('No symbols detected');
      }

      // Step 3: Recognize each symbol
      const recognizedSymbols = [];
      for (const symbol of symbols) {
        const symbolCanvas = document.createElement('canvas');
        symbolCanvas.width = symbol.bbox.width;
        symbolCanvas.height = symbol.bbox.height;
        const ctx = symbolCanvas.getContext('2d')!;
        
        // Extract symbol region from main canvas
        ctx.drawImage(canvas, 
          symbol.bbox.x, symbol.bbox.y, symbol.bbox.width, symbol.bbox.height,
          0, 0, symbol.bbox.width, symbol.bbox.height
        );

        try {
          const result = await recognizerRef.current.recognize(symbolCanvas);
          const classifiedSymbol = classifierRef.current.classifySymbol(result.expression, result.confidence);
          recognizedSymbols.push({
            ...classifiedSymbol,
            bbox: symbol.bbox
          });
        } catch (error) {
          console.warn('[useMathRecognition] Failed to recognize symbol:', error);
          // Add as unknown symbol
          recognizedSymbols.push({
            symbol: '?',
            confidence: 0.1,
            bbox: symbol.bbox
          });
        }
      }

      // Step 4: Build expression
      const expression = classifierRef.current.buildExpression(recognizedSymbols);
      const confidence = recognizedSymbols.reduce((sum, s) => sum + s.confidence, 0) / recognizedSymbols.length;

      const result: RecognitionResult = {
        expression,
        confidence,
        symbols: recognizedSymbols,
        processingTime: 0
      };

      setLastResult(result);
      console.log(`[useMathRecognition] Final result: "${expression}" (${(confidence * 100).toFixed(0)}% confidence)`);
      
      return result;
      
    } catch (error) {
      console.error('[useMathRecognition] Recognition failed:', error);
      throw error;
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const clearGestures = useCallback(() => {
    detectorRef.current?.clearGestures();
    setLastResult(null);
    console.log('[useMathRecognition] Gestures cleared');
  }, []);

  const isDeleteGesture = useCallback((points: any[]): boolean => {
    return detectorRef.current?.isScribbleGesture(points) || false;
  }, []);

  return {
    recognize,
    isReady,
    isProcessing,
    lastResult,
    clearGestures,
    isDeleteGesture,
    ready: isReady
  };
}
