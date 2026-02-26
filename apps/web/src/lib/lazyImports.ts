// Lazy loading utilities for heavy dependencies
export const lazyImportFabric = () => import('fabric');
export const lazyImportTesseract = () => import('tesseract.js');
export const lazyImportJsPDF = () => import('jspdf');
export const lazyImportMathJS = () => import('mathjs');

// Type definitions for lazy imports
export type FabricModule = typeof import('fabric');
export type TesseractModule = typeof import('tesseract.js');
export type JsPDFModule = typeof import('jspdf');
export type MathJSModule = typeof import('mathjs');

// Extract specific types from fabric module
export type FabricCanvas = import('fabric').Canvas;
export type FabricLine = import('fabric').Line;
export type FabricObject = import('fabric').Object;
