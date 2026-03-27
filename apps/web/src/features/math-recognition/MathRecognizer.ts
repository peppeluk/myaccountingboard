import * as tf from '@tensorflow/tfjs';
import { RecognitionResult } from './types';

export class MathRecognizer {
  private model: tf.LayersModel | null = null;
  private isModelLoading = false;
  private isReady = false;

  constructor() {
    this.loadModel();
  }

  private async loadModel(): Promise<void> {
    if (this.isModelLoading || this.model) return;
    
    this.isModelLoading = true;
    console.log('[MathRecognizer] Math Recognition temporarily disabled');
    
    // Temporarily disabled due to 404 error on model URL
    // this.model = await tf.loadLayersModel('https://storage.googleapis.com/tfjs-models/tfjs/mnist_cnn/model.json');
    // this.isReady = true;
    // console.log('[MathRecognizer] Model loaded successfully');
    
    this.isModelLoading = false;
  }

  async recognize(canvas: HTMLCanvasElement): Promise<RecognitionResult> {
    if (!this.model || !this.isReady) {
      throw new Error('Model not loaded');
    }

    const startTime = performance.now();
    
    try {
      // Preprocess canvas
      const processedCanvas = this.preprocessCanvas(canvas);
      const imageTensor = tf.browser.fromPixels(processedCanvas)
        .resizeBilinear([28, 28])
        .toFloat()
        .expandDims(0);

      // Predict
      const prediction = await this.model.predict(imageTensor) as tf.Tensor;
      const probabilities = await prediction.data();
      
      // Get top prediction
      const maxProb = Math.max(...Array.from(probabilities as Float32Array));
      const predictedDigit = Array.from(probabilities as Float32Array).indexOf(maxProb);
      
      // Clean up
      tf.dispose([imageTensor, prediction]);
      processedCanvas.remove();

      const processingTime = performance.now() - startTime;
      
      const result: RecognitionResult = {
        expression: predictedDigit.toString(),
        confidence: maxProb,
        symbols: [{
          symbol: predictedDigit.toString(),
          confidence: maxProb,
          bbox: { x: 0, y: 0, width: 28, height: 28 }
        }],
        processingTime
      };

      console.log(`[MathRecognizer] Result: "${result.expression}" (${(result.confidence * 100).toFixed(0)}% confidence)`);
      return result;
      
    } catch (error) {
      console.error('[MathRecognizer] Recognition failed:', error);
      throw error;
    }
  }

  private preprocessCanvas(canvas: HTMLCanvasElement): HTMLCanvasElement {
    const processedCanvas = document.createElement('canvas');
    processedCanvas.width = 28;
    processedCanvas.height = 28;
    const ctx = processedCanvas.getContext('2d')!;
    
    // Clear and set white background
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, 28, 28);
    
    // Draw original canvas content (inverted for MNIST)
    ctx.drawImage(canvas, 0, 0, 28, 28);
    
    // Apply threshold for better recognition
    const imageData = ctx.getImageData(0, 0, 28, 28);
    const data = imageData.data;
    
    for (let i = 0; i < data.length; i += 4) {
      const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      const threshold = gray > 128 ? 255 : 0;
      data[i] = threshold;     // R
      data[i + 1] = threshold; // G
      data[i + 2] = threshold; // B
      data[i + 3] = 255;     // A
    }
    
    ctx.putImageData(imageData, 0, 0);
    return processedCanvas;
  }

  get ready(): boolean {
    return this.isReady;
  }

  get loading(): boolean {
    return this.isModelLoading;
  }
}
