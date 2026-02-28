// OCR utility functions - estratte da App.tsx
// Queste funzioni sono pure e testabili

export function normalizeExpression(input: string): string {
  return input
    .replace(/\s+/g, "")
    .replace(/[xX\u00D7]/g, "*")
    .replace(/[:\u00F7]/g, "/")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/[^\d+\-*/().%^]/g, "")
    .trim();
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
