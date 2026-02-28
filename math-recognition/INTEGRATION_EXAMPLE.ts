/**
 * INTEGRATION EXAMPLE FOR APP.TSX
 * 
 * Questo file mostra ESATTAMENTE come integrare Math Recognition nel tuo App.tsx esistente.
 * Segui gli step numerati per evitare breaking changes.
 */

// ========================================
// STEP 1: ADD IMPORTS (at top of App.tsx)
// ========================================
import { useMathRecognition } from './features/math-recognition';


// ========================================
// STEP 2: ADD STATE (inside App component, dopo gli altri useState)
// ========================================
function App() {
  // ... existing states ...
  
  // NEW: Math Recognition
  const [useMathRec, setUseMathRec] = useState(false);
  const mathRec = useMathRecognition();

  // ... rest of component ...
}


// ========================================
// STEP 3: MODIFY OCR LOGIC (trova la tua funzione OCR esistente)
// ========================================

// BEFORE (your current code):
/*
const performOCR = async (canvas: HTMLCanvasElement) => {
  const worker = workerRef.current;
  if (!worker) return;
  
  const result = await worker.recognize(canvas);
  const text = normalizeOcrChunk(result.data.text);
  setDisplay(text);
};
*/

// AFTER (wrapped with Math Recognition):
const performOCR = useCallback(async (canvas: HTMLCanvasElement) => {
  // === NEW: TRY MATH RECOGNITION FIRST ===
  if (useMathRec && mathRec.isReady) {
    try {
      console.log('[OCR] Using Math Recognition');
      const result = await mathRec.recognize(canvas);
      
      // Usa la tua funzione normalizeOcrChunk esistente se vuoi
      // const normalized = normalizeOcrChunk(result.expression);
      
      setDisplay(result.expression);
      setOcrStatus(`🧮 Math: ${(result.confidence * 100).toFixed(0)}%`);
      
      console.log('[OCR] Math result:', result.expression);
      return; // SUCCESS - stop here
    } catch (error) {
      console.error('[OCR] Math recognition failed:', error);
      // Continue to Tesseract fallback below
    }
  }

  // === EXISTING: TESSERACT (unchanged) ===
  console.log('[OCR] Using Tesseract');
  const worker = workerRef.current;
  if (!worker) return;
  
  try {
    const result = await worker.recognize(canvas);
    const text = normalizeOcrChunk(result.data.text);
    setDisplay(text);
    setOcrStatus(`📝 Text: ${text ? '✓' : '✗'}`);
  } catch (error) {
    console.error('[OCR] Tesseract failed:', error);
    setOcrStatus('❌ OCR failed');
  }
}, [useMathRec, mathRec, setDisplay, setOcrStatus]); // Dependencies


// ========================================
// STEP 4: ADD GESTURE DETECTION (nel tuo canvas handler)
// ========================================

// Trova il tuo handler per mouse:up o path:created
// Esempio con Fabric.js:

canvas.on('mouse:up', (event) => {
  // === NEW: GESTURE DETECTION ===
  if (useMathRec && mathRec.isReady) {
    // Ottieni lo stroke corrente (adatta al tuo codice)
    const currentPath = canvas.getActiveObject();
    if (!currentPath || currentPath.type !== 'path') {
      return;
    }

    // Converti path in array di punti
    const stroke = extractPointsFromPath(currentPath); // Vedi helper sotto
    const timestamps = extractTimestampsFromPath(currentPath); // Vedi helper sotto

    // Rileva scribble
    if (mathRec.detectScribble(stroke, timestamps)) {
      console.log('[Gesture] 🗑️ Scribble detected!');
      
      // Ottieni tutti gli stroke (adatta al tuo codice)
      const allPaths = canvas.getObjects().filter(obj => obj.type === 'path');
      const allStrokes = allPaths.map(path => extractPointsFromPath(path));
      
      // Trova overlapping
      const overlapping = mathRec.findOverlappingStrokes(stroke, allStrokes);
      
      // Cancella gli stroke overlapping
      overlapping.forEach(index => {
        if (allPaths[index]) {
          canvas.remove(allPaths[index]);
        }
      });
      
      canvas.renderAll();
      return; // Don't process as normal stroke
    }
  }

  // === EXISTING: NORMAL STROKE PROCESSING ===
  // ... your existing code ...
});


// ========================================
// HELPER FUNCTIONS (aggiungi queste)
// ========================================

/**
 * Extract points array from Fabric.js path
 */
function extractPointsFromPath(path: any): Array<{x: number, y: number}> {
  if (!path.path) return [];
  
  const points: Array<{x: number, y: number}> = [];
  
  for (const command of path.path) {
    if (command[0] === 'M' || command[0] === 'L') {
      // M (moveto) and L (lineto) have x, y coordinates
      points.push({ x: command[1], y: command[2] });
    } else if (command[0] === 'Q') {
      // Q (quadratic curve) has control point and end point
      points.push({ x: command[3], y: command[4] });
    }
  }
  
  return points;
}

/**
 * Extract timestamps (estimated if not tracked)
 */
function extractTimestampsFromPath(path: any): number[] {
  const points = extractPointsFromPath(path);
  
  // Se non hai timestamps reali, stimali
  const now = Date.now();
  return points.map((_, i) => now - (points.length - i) * 10);
}


// ========================================
// STEP 5: ADD TOGGLE BUTTON (nella tua toolbar)
// ========================================

// Trova la tua toolbar con gli altri bottoni strumenti
<div className="toolbar">
  {/* ... existing buttons ... */}

  {/* NEW: Math Recognition Toggle */}
  <button
    className={`icon-button ${useMathRec ? 'active' : ''}`}
    onClick={() => setUseMathRec(!useMathRec)}
    title={useMathRec ? 'Math Recognition: ON' : 'Math Recognition: OFF'}
    type="button"
  >
    <i className={`fa-solid ${useMathRec ? 'fa-calculator' : 'fa-font'}`} />
    <span className="sr-only">
      {useMathRec ? 'Math Recognition' : 'Text Recognition'}
    </span>
  </button>
  
  {/* Status indicator */}
  {mathRec.isReady && useMathRec && (
    <span className="math-rec-status">
      {mathRec.isRecognizing ? '⏳' : '✓'} Math
    </span>
  )}
  
  {mathRec.error && useMathRec && (
    <span className="math-rec-error" title={mathRec.error}>
      ❌ Math Error
    </span>
  )}
</div>


// ========================================
// STEP 6: ADD CSS (in styles.css)
// ========================================
/*
.icon-button.active {
  background: var(--primary-color, #3b82f6);
  color: white;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
}

.math-rec-status {
  font-size: 0.875rem;
  color: #10b981;
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  background: rgba(16, 185, 129, 0.1);
}

.math-rec-error {
  font-size: 0.875rem;
  color: #ef4444;
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  background: rgba(239, 68, 68, 0.1);
  cursor: help;
}
*/


// ========================================
// COMPLETE EXAMPLE - Simplified Version
// ========================================

function AppSimplified() {
  // 1. States
  const [useMathRec, setUseMathRec] = useState(false);
  const mathRec = useMathRecognition();

  // 2. OCR Handler
  const handleOCR = async (canvas: HTMLCanvasElement) => {
    if (useMathRec && mathRec.isReady) {
      try {
        const result = await mathRec.recognize(canvas);
        console.log('Math:', result.expression);
        return result.expression;
      } catch (e) {
        console.error('Math failed:', e);
      }
    }
    
    // Fallback to existing OCR
    return await yourExistingOCR(canvas);
  };

  // 3. Gesture Handler
  const handleStroke = (stroke, timestamps, allStrokes) => {
    if (useMathRec && mathRec.isReady) {
      if (mathRec.detectScribble(stroke, timestamps)) {
        const toDelete = mathRec.findOverlappingStrokes(stroke, allStrokes);
        deleteStrokes(toDelete);
        return;
      }
    }
    
    // Normal processing
    processStroke(stroke);
  };

  // 4. UI
  return (
    <div>
      <button onClick={() => setUseMathRec(!useMathRec)}>
        {useMathRec ? '🧮 Math' : '📝 Text'}
      </button>
      {/* ... rest of UI ... */}
    </div>
  );
}


// ========================================
// TESTING CHECKLIST
// ========================================
/*
✅ 1. Toggle button appare nella toolbar
✅ 2. Click toggle → stato cambia (vedi icona)
✅ 3. Scrivi "2+3" → vedi riconoscimento in console
✅ 4. Display calcolatrice mostra "2+3"
✅ 5. Scarabocchia veloce → cancella strokes
✅ 6. Toggle OFF → torna a Tesseract
✅ 7. Nessun errore in console
✅ 8. Performance OK (no lag)
*/


// ========================================
// DEBUG TIPS
// ========================================
/*
1. Apri Console del browser (F12)
2. Cerca log che iniziano con:
   - [MathRecognizer]
   - [SymbolSegmenter]
   - [GestureDetector]
   - [OCR]

3. Se vedi "Model not loaded":
   - Aspetta 3-5 secondi dopo page load
   - Controlla connessione internet
   - Verifica che TensorFlow.js sia installato

4. Se riconoscimento è impreciso:
   - Scrivi più grande (min 20x20px per cifra)
   - Lascia spazio tra simboli (15px+)
   - Scrivi più lentamente e chiaramente

5. Se scribble non funziona:
   - Muovi più velocemente (800+ px/s)
   - Fai più movimenti zigzag (5+)
   - Abbassa threshold in GestureDetector.ts
*/
