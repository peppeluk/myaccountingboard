export interface MathSymbol {
  symbol: string;
  confidence: number;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface MathExpression {
  expression: string;
  confidence: number;
  symbols: MathSymbol[];
}

export interface RecognitionResult {
  expression: string;
  confidence: number;
  symbols: MathSymbol[];
  processingTime: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GesturePath {
  points: Point[];
  timestamp: number;
}
