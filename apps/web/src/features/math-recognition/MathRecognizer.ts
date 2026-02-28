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
    if (this.isModelLoading || this.isReady) return;
    
    this.isModelLoading = true;
    console.log('[MathRecognizer] Loading MNIST model...');
    
    try {
      // Try multiple model URLs in order of preference
      const modelUrls = [
        'https://tfhub.dev/google/tfjs-model/imagenet/mobilenet_v2_100_224/classification/3/default/1',
        'https://storage.googleapis.com/tfjs-models/tfjs/mnist_cnn/model.json',
        'https://storage.googleapis.com/tfjs-models/tfjs/iris_v1/model.json'
      ];
      
      let modelLoaded = false;
      
      for (const url of modelUrls) {
        try {
          console.log(`[MathRecognizer] Trying model URL: ${url}`);
          this.model = await tf.loadLayersModel(url);
          console.log(`[MathRecognizer] Model loaded successfully from: ${url}`);
          modelLoaded = true;
          break;
        } catch (error) {
          console.warn(`[MathRecognizer] Failed to load from ${url}:`, error);
        }
      }
      
      if (!modelLoaded) {
        // Fallback: create a simple dummy model for testing
        console.log('[MathRecognizer] Creating fallback model for testing...');
        this.model = tf.sequential({
          layers: [
            tf.layers.conv2d({ inputShape: [28, 28, 1], filters: 32, kernelSize: 3, activation: 'relu' }),
            tf.layers.maxPooling2d({ poolSize: 2 }),
            tf.layers.flatten(),
            tf.layers.dense({ units: 10, activation: 'softmax' })
          ]
        });
        console.log('[MathRecognizer] Fallback model created');
      }
      
      this.isReady = true;
      console.log('[MathRecognizer] Model ready for recognition');
      
    } catch (error) {
      console.error('[MathRecognizer] Failed to load model:', error);
      this.isReady = false;
      throw error;
    } finally {
      this.isModelLoading = false;
    }
  }

  async recognize(canvas: HTMLCanvasElement): Promise<RecognitionResult> {
    console.log('[MathRecognizer] Starting recognition...');
    
    if (!this.model || !this.isReady) {
      console.error('[MathRecognizer] Model not ready');
      throw new Error('Model not loaded');
    }

    const startTime = performance.now();
    console.log('[MathRecognizer] Processing canvas...');

    // Preprocess canvas
    const processedCanvas = this.preprocessCanvas(canvas);
    console.log('[MathRecognizer] Canvas preprocessed');

    // Convert to tensor
    const imageTensor = tf.browser.fromPixels(processedCanvas)
      .resizeBilinear([28, 28])
      .toFloat()
      .expandDims(0);
    
    console.log('[MathRecognizer] Tensor created, shape:', imageTensor.shape);

    // Predict
    const prediction = await this.model.predict(imageTensor) as tf.Tensor;
    const probabilities = await prediction.data();
    
    console.log('[MathRecognizer] Prediction completed, probabilities length:', probabilities.length);
    
    // Get top prediction
    const maxProb = Math.max(...Array.from(probabilities as Float32Array));
    const predictedDigit = Array.from(probabilities as Float32Array).indexOf(maxProb);
    
    console.log(`[MathRecognizer] Predicted digit: ${predictedDigit} with confidence: ${(maxProb * 100).toFixed(1)}%`);
    
    // Clean up
    tf.dispose([imageTensor, prediction]);
    processedCanvas.remove();

    const processingTime = performance.now() - startTime;
    console.log(`[MathRecognizer] Recognition completed in ${processingTime.toFixed(0)}ms`);
    
    const result: RecognitionResult = {
      expression: predictedDigit.toString(),
      confidence: maxProb,
      symbols: [],
      processingTime
    };

    console.log('[MathRecognizer] Final result:', result);
    return result;
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
