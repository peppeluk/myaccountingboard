# Math Recognition Module

## Overview
Advanced mathematical expression recognition system using TensorFlow.js for real-time digit and symbol recognition.

## Features

### 🧠 Core Recognition
- **MNIST Model**: Pre-trained TensorFlow.js model for digit recognition
- **Symbol Segmentation**: Automatic detection of individual mathematical symbols
- **Operator Classification**: Pattern matching for mathematical operators (+, -, ×, ÷, =)
- **Expression Building**: Combines symbols into complete mathematical expressions

### 🖱️ Gesture Detection
- **Scribble Detection**: Identifies delete gestures (random scribbling)
- **Touch Support**: Works with both mouse and touch input
- **Path Analysis**: Analyzes drawing patterns for gesture classification

### ⚡ Performance
- **Real-time Processing**: <500ms recognition time
- **Confidence Scoring**: Provides accuracy metrics
- **Fallback Support**: Graceful degradation to Tesseract OCR

## Usage

```typescript
import { useMathRecognition } from './features/math-recognition';

const mathRec = useMathRecognition();

// Recognize math from canvas
const result = await mathRec.recognize(canvas);
console.log(result.expression); // "2+3"
console.log(result.confidence); // 0.85

// Check system status
console.log(mathRec.isReady); // true
console.log(mathRec.isProcessing); // false
```

## Components

### MathRecognizer
Core recognition engine using TensorFlow.js MNIST model.

```typescript
const recognizer = new MathRecognizer();
await recognizer.recognize(canvas); // RecognitionResult
```

### GestureDetector
Handles mouse/touch input and gesture recognition.

```typescript
const detector = new GestureDetector();
const isDelete = detector.isScribbleGesture(points);
```

### SymbolSegmenter
Segments canvas into individual mathematical symbols.

```typescript
const segmenter = new SymbolSegmenter();
const symbols = segmenter.segmentSymbols(canvas);
```

### OperatorClassifier
Classifies symbols and builds mathematical expressions.

```typescript
const classifier = new OperatorClassifier();
const expression = classifier.buildExpression(symbols);
```

## Integration

### Step 1: Import
```typescript
import { useMathRecognition } from './features/math-recognition';
```

### Step 2: Initialize Hook
```typescript
const mathRec = useMathRecognition();
```

### Step 3: Use Recognition
```typescript
const handleOCR = async (canvas: HTMLCanvasElement) => {
  if (mathRec.isReady) {
    try {
      const result = await mathRec.recognize(canvas);
      // Use result.expression
      // Use result.confidence
    } catch (error) {
      // Handle error
    }
  }
};
```

## Configuration

### Model Loading
- Automatic MNIST model loading from Google CDN
- 2-3 seconds initial load time
- Ready state tracking

### Recognition Parameters
- **Min Symbol Size**: 15px
- **Max Symbol Size**: 60px
- **Gesture Threshold**: 30% direction changes

## Performance Metrics

- **Recognition Speed**: <500ms
- **Accuracy**: 85-95% for clear digits
- **Memory Usage**: ~50MB model size
- **CPU Usage**: Low (TensorFlow.js optimization)

## Error Handling

### Model Loading Errors
```typescript
try {
  const result = await mathRec.recognize(canvas);
} catch (error) {
  if (error.message === 'Model not loaded') {
    // Wait for model to load
    setTimeout(() => retry(), 1000);
  }
}
```

### Recognition Failures
- **No Symbols Detected**: Empty canvas or unclear drawing
- **Low Confidence**: Poor handwriting quality
- **Model Errors**: Network issues loading TensorFlow.js

## Browser Compatibility

### ✅ Supported
- Chrome 80+
- Firefox 75+
- Safari 13+
- Edge 80+

### ⚠️ Requirements
- WebGL support (for TensorFlow.js acceleration)
- Canvas 2D context
- ES6+ JavaScript

## Debugging

### Console Logs
```
[MathRecognizer] Loading MNIST model...
[MathRecognizer] Model loaded successfully
[SymbolSegmenter] Found 3 symbols
[OperatorClassifier] Building expression: "2+3"
[useMathRecognition] Final result: "2+3" (85% confidence)
```

### Performance Monitoring
```typescript
console.log(`Processing time: ${result.processingTime}ms`);
console.log(`Confidence: ${(result.confidence * 100).toFixed(0)}%`);
```

## Troubleshooting

### Issue: Low Recognition Accuracy
**Solution**: 
- Write larger symbols (min 20x20px)
- Leave space between symbols (15px+)
- Write clearly and slowly
- Ensure good contrast

### Issue: Model Loading Fails
**Solution**:
- Check internet connection
- Verify @tensorflow/tfjs is installed
- Clear browser cache

### Issue: Memory Leaks
**Solution**:
- Dispose TensorFlow tensors
- Clear gesture history
- Remove event listeners on cleanup

## Advanced Usage

### Custom Symbol Training
```typescript
// Replace MNIST with custom model
const customModel = await tf.loadLayersModel('./custom-model.json');
recognizer.setModel(customModel);
```

### Gesture Customization
```typescript
// Adjust scribble detection sensitivity
detector.setScribbleThreshold(0.25); // Default: 0.30
```

## API Reference

### useMathRecognition Hook
```typescript
interface MathRecognitionHook {
  recognize: (canvas: HTMLCanvasElement) => Promise<RecognitionResult>;
  isReady: boolean;
  isProcessing: boolean;
  lastResult: RecognitionResult | null;
  clearGestures: () => void;
  isDeleteGesture: (points: Point[]) => boolean;
}
```

### RecognitionResult
```typescript
interface RecognitionResult {
  expression: string;      // "2+3", "12×5", etc.
  confidence: number;      // 0.0 - 1.0
  symbols: MathSymbol[];  // Individual recognized symbols
  processingTime: number; // Milliseconds
}
```

## Version History

### v1.0.0
- Initial release
- MNIST digit recognition
- Basic operator classification
- Gesture detection
- React hook integration

---

**For detailed implementation examples, see INTEGRATION_EXAMPLE.ts**
