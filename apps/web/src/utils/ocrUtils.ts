// OCR utility functions - estratte da App.tsx
// Queste funzioni sono pure e testabili

// Calcolatrice nativa come fallback per mathjs
export function evaluateExpressionNative(expression: string): number {
  try {
    // Funzione sicura per valutare espressioni matematiche
    // Rimuovi caratteri non sicuri
    const safeExpression = expression.replace(/[^0-9+\-*/().\s]/g, '');
    
    // Valutazione sicura usando Function constructor
    const result = new Function('return ' + safeExpression)();
    
    if (typeof result === 'number' && !isNaN(result)) {
      return result;
    }
    
    throw new Error('Risultato non valido');
  } catch (error) {
    throw new Error(`Calcolo fallito: ${error instanceof Error ? error.message : 'errore sconosciuto'}`);
  }
}

export function normalizeExpression(input: string): string {
  if (!input) return "";
  
  // Step 1: Pulizia base - rimuovi solo spazi eccessivi
  let normalized = input.trim().replace(/\s+/g, " ");
  
  // Step 2: Sostituzioni operatori standard
  normalized = normalized
    .replace(/[xX\u00D7×✕✖＊⋅·•*]/g, "*")
    .replace(/[:\u00F7÷／]/g, "/")
    .replace(/[‐‑‒–—−﹣_~]/g, "-")
    .replace(/[＋﹢]/g, "+");
  
  // Step 3: Gestione decimali (più permissiva)
  normalized = normalized.replace(/(\d)\s*,\s*(\d)/g, "$1.$2");
  
  // Step 4: Rimuovi caratteri non validi ma mantieni spazi tra operatori
  normalized = normalized.replace(/[^\d\s+\-*/().%^]/g, "");
  
  // Step 5: Pulizia finale spazi
  normalized = normalized.replace(/\s+/g, "");
  
  return normalized;
}

export function validateExpression(expression: string): { valid: boolean; error?: string } {
  if (!expression) {
    return { valid: false, error: "Espressione vuota" };
  }
  
  // Controlla parentesi bilanciate
  let openParens = 0;
  for (const char of expression) {
    if (char === '(') openParens++;
    if (char === ')') openParens--;
    if (openParens < 0) {
      return { valid: false, error: "Parentesi non bilanciate" };
    }
  }
  if (openParens !== 0) {
    return { valid: false, error: "Parentesi non bilanciate" };
  }
  
  // Controlla caratteri validi
  const validChars = /^[0-9+\-*/().%^ ]+$/;
  if (!validChars.test(expression)) {
    return { valid: false, error: "Caratteri non validi" };
  }
  
  // Controlla operatori consecutivi (escluso meno unario)
  const consecutiveOps = /[+\-*/%]{2,}/;
  if (consecutiveOps.test(expression.replace(/\s/g, ""))) {
    return { valid: false, error: "Operatori consecutivi" };
  }
  
  return { valid: true };
}

export function formatExpressionForDisplay(input: string): string {
  return input.replace(/\*/g, "x").replace(/\//g, ":");
}

export function normalizeOcrOperators(input: string): string {
  return input
    .replace(/[‐‑‒–—−﹣_~]/g, "-")
    .replace(/[＋﹢]/g, "+")
    .replace(/[×✕✖＊⋅·•*]/g, "x")
    .replace(/[÷／]/g, ":")
    .replace(/([0-9)%])([tT†┼╋])(?=[0-9(])/g, "$1+")
    .replace(/([0-9)%])([;])(?=[0-9(])/g, "$1:")
    .replace(/([0-9)%])([xX])(?=[0-9(])/g, "$1x")
    .replace(/([0-9)%])([:/])(?=[0-9(])/g, "$1:");
}

export function normalizeOcrChunk(input: string): string {
  const normalizedOperators = normalizeOcrOperators(input);
  return normalizedOperators
    .replace(/\s+/g, "")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/[^\d+\-x:().%^=]/g, "")
    .replace(/\+{2,}/g, "+")
    .replace(/x{2,}/g, "x")
    .replace(/:{2,}/g, ":")
    .trim();
}

export function mergeRecognizedText(previous: string, nextChunk: string): string {
  if (!nextChunk) {
    return previous;
  }
  if (!previous) {
    return nextChunk;
  }
  if (previous.endsWith(nextChunk)) {
    return previous;
  }
  if (nextChunk.startsWith(previous)) {
    return nextChunk;
  }

  const maxOverlap = Math.min(previous.length, nextChunk.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (previous.slice(-overlap) === nextChunk.slice(0, overlap)) {
      return `${previous}${nextChunk.slice(overlap)}`;
    }
  }
  return `${previous}${nextChunk}`;
}
