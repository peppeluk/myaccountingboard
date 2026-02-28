import { MathSymbol } from './types';

export class OperatorClassifier {
  private readonly operators = {
    '+': { pattern: /^[+]$/, weight: 1.0 },
    '-': { pattern: /^-$/, weight: 1.0 },
    '×': { pattern: /^[×x]$/, weight: 1.0 },
    '÷': { pattern: /^[÷\/]$/, weight: 1.0 },
    '=': { pattern: /^=$/, weight: 1.0 },
    '(': { pattern: /^\($/, weight: 0.5 },
    ')': { pattern: /^\)$/, weight: 0.5 }
  };

  classifySymbol(symbol: string, confidence: number): MathSymbol {
    // Check if symbol matches any operator pattern
    for (const [operator, config] of Object.entries(this.operators)) {
      if (config.pattern.test(symbol)) {
        return {
          symbol: operator,
          confidence: confidence * config.weight,
          bbox: { x: 0, y: 0, width: 20, height: 20 }
        };
      }
    }

    // If not an operator, return as-is (likely a digit)
    return {
      symbol,
      confidence,
      bbox: { x: 0, y: 0, width: 20, height: 20 }
    };
  }

  buildExpression(symbols: MathSymbol[]): string {
    let expression = '';
    let lastX = 0;

    for (const symbol of symbols) {
      // Add spacing between symbols
      if (lastX > 0 && symbol.bbox.x - lastX > 15) {
        expression += ' ';
      }
      
      expression += symbol.symbol;
      lastX = symbol.bbox.x + symbol.bbox.width;
    }

    return expression.trim();
  }

  isMathExpression(text: string): boolean {
    // Check if text contains mathematical operators
    const mathPatterns = [
      /\d+[+\-×÷]\d+/, // Simple operations
      /\d+[+\-×÷]\d+[=]\d+/, // Equations
      /\([^\)]+\)/, // Parentheses
      /\d+/, // At least one digit
    ];

    return mathPatterns.some(pattern => pattern.test(text));
  }

  validateExpression(expression: string): boolean {
    try {
      // Basic validation - check for balanced parentheses
      let parentheses = 0;
      for (const char of expression) {
        if (char === '(') parentheses++;
        if (char === ')') parentheses--;
        if (parentheses < 0) return false;
      }
      
      return parentheses === 0;
    } catch {
      return false;
    }
  }

  getOperatorPrecedence(operator: string): number {
    const precedence: { [key: string]: number } = {
      '+': 1,
      '-': 1,
      '×': 2,
      '÷': 2,
      '/': 2
    };
    
    return precedence[operator] || 0;
  }

  formatExpression(symbols: MathSymbol[]): string {
    const expression = this.buildExpression(symbols);
    
    // Add spaces around operators for readability
    return expression
      .replace(/([+\-×÷=])/g, ' $1 ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
