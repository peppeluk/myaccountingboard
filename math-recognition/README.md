# 🧮 Math Handwriting Recognition System

Sistema completo di riconoscimento della scrittura a mano per espressioni matematiche con supporto gesture "scribble-to-delete".

## ✨ Features

- ✅ **Riconoscimento cifre** (0-9) usando TensorFlow.js MNIST model
- ✅ **Riconoscimento operatori** (+, -, ×, ÷, =, (, ), %, ^)
- ✅ **Gesture "scribble-to-delete"** - scarabocchia per cancellare
- ✅ **100% gratis** - nessun API key o costo
- ✅ **Privacy-first** - tutto on-device
- ✅ **Feature flag** - attiva/disattiva senza breaking changes
- ✅ **Fallback automatico** - torna a Tesseract se errori

## 📦 Installazione

### 1. Aggiungi TensorFlow.js

```bash
npm install @tensorflow/tfjs
```

### 2. Copia i file del modulo

Copia l'intera cartella `math-recognition/` in `src/features/`:

```
src/
├── features/
│   └── math-recognition/
│       ├── index.ts
│       ├── MathRecognizer.ts
│       ├── GestureDetector.ts
│       ├── SymbolSegmenter.ts
│       ├── OperatorClassifier.ts
│       ├── useMathRecognition.ts
│       └── types.ts
```

## 🚀 Integrazione in App.tsx

### Step 1: Import

```typescript
import { useMathRecognition } from './features/math-recognition';
```

### Step 2: Aggiungi state e hook

```typescript
function App() {
  // ... existing states ...

  // NEW: Math recognition state
  const [useMathRec, setUseMathRec] = useState(false);
  const mathRec = useMathRecognition();

  // ... rest of component ...
}
```

### Step 3: Modifica riconoscimento OCR

Trova la funzione che fa OCR e wrappa così:

```typescript
const performRecognition = useCallback(async (canvas: HTMLCanvasElement) => {
  // NEW: Check if math recognition is enabled
  if (useMathRec && mathRec.isReady) {
    try {
      console.log('[OCR] Using Math Recognition');
      const result = await mathRec.recognize(canvas);
      
      // Update calculator display
      setDisplay(result.expression);
      setOcrStatus(`Math: ${(result.confidence * 100).toFixed(0)}%`);
      
      return;
    } catch (error) {
      console.error('[OCR] Math recognition failed, fallback to Tesseract:', error);
      // Fallback to Tesseract below
    }
  }

  // EXISTING: Tesseract OCR (unchanged)
  console.log('[OCR] Using Tesseract');
  // ... your existing Tesseract code ...
}, [useMathRec, mathRec, setDisplay, setOcrStatus]);
```

### Step 4: Aggiungi gesture detection

Nel tuo handler `mouse:up` o `touch:end`:

```typescript
canvas.on('mouse:up', async (event) => {
  // NEW: Gesture detection
  if (useMathRec && mathRec.isReady) {
    const currentStroke = getCurrentStroke(); // Your function to get current stroke
    const timestamps = getCurrentTimestamps(); // Your function to get timestamps
    
    // Check if it's a scribble gesture
    if (mathRec.detectScribble(currentStroke, timestamps)) {
      console.log('[Gesture] Scribble detected!');
      
      // Find overlapping strokes
      const allStrokes = getAllStrokes(); // Your function to get all strokes
      const overlapping = mathRec.findOverlappingStrokes(currentStroke, allStrokes);
      
      // Delete overlapping strokes
      deleteStrokes(overlapping); // Your function to delete strokes
      
      return; // Don't continue with normal processing
    }
  }

  // EXISTING: Normal stroke handling
  // ... your existing code ...
});
```

### Step 5: Aggiungi toggle button nella toolbar

```typescript
<button
  className={`icon-button ${useMathRec ? 'active' : ''}`}
  onClick={() => setUseMathRec(!useMathRec)}
  title={useMathRec ? 'Math Recognition ON' : 'Math Recognition OFF'}
  type="button"
>
  <i className={`fa-solid ${useMathRec ? 'fa-calculator' : 'fa-font'}`} />
  <span className="sr-only">
    {useMathRec ? 'Math Recognition' : 'Text Recognition'}
  </span>
</button>
```

## 📖 API Reference

### `useMathRecognition()`

Hook principale per il riconoscimento.

**Returns:**
```typescript
{
  isReady: boolean;              // True quando il modello è caricato
  isRecognizing: boolean;        // True durante il riconoscimento
  error: string | null;          // Messaggio errore se fallisce
  recognize: (canvas) => Promise<RecognitionResult>;
  detectScribble: (stroke, timestamps) => boolean;
  findOverlappingStrokes: (scribble, allStrokes) => number[];
  clearError: () => void;
}
```

**Esempio:**
```typescript
const mathRec = useMathRecognition();

// Aspetta che sia pronto
if (mathRec.isReady) {
  const result = await mathRec.recognize(canvas);
  console.log(result.expression); // "2+3"
  console.log(result.confidence); // 0.85
}
```

### `RecognitionResult`

```typescript
interface RecognitionResult {
  expression: string;      // Espressione normalizzata: "2+3x4"
  confidence: number;      // 0-1, quanto è sicuro il riconoscimento
  segments: SegmentedSymbol[]; // Simboli individuali riconosciuti
}
```

### Gestione Errori

```typescript
if (mathRec.error) {
  console.error('Math recognition error:', mathRec.error);
  // Fallback to Tesseract or show error to user
}
```

## 🎨 Styling

Aggiungi questi stili nel tuo CSS:

```css
/* Toggle button active state */
.icon-button.active {
  background: var(--primary-color);
  color: white;
}

/* Math recognition status indicator */
.ocr-status.math-mode {
  color: #10b981;
}

.ocr-status.math-mode::before {
  content: '🧮 ';
}
```

## 🧪 Testing

### Test Manuale

1. Abilita Math Recognition con il toggle button
2. Scrivi "2+3" sul canvas
3. Aspetta il riconoscimento automatico
4. Verifica che la calcolatrice mostri "2+3"
5. Prova a scarabocchiare velocemente per cancellare

### Test Gesture

1. Scrivi "123"
2. Scarabocchia avanti-indietro velocemente sopra il "2"
3. Verifica che il "2" venga cancellato

### Debug

Attiva la console del browser per vedere i log:

```
[MathRecognizer] Loading MNIST model...
[MathRecognizer] Model loaded successfully
[MathRecognizer] Segmenting symbols...
[MathRecognizer] Found 3 segments
[MathRecognizer] Recognition completed in 245ms
[MathRecognizer] Result: "2+3" (confidence: 85.3%)
```

## ⚙️ Configurazione

### Modifica sensibilità scribble

In `GestureDetector.ts`:

```typescript
private readonly SCRIBBLE_DIRECTION_CHANGES = 5; // Aumenta = più difficile
private readonly SCRIBBLE_MIN_SPEED = 800;       // Aumenta = deve essere più veloce
```

### Modifica threshold segmentazione

In `SymbolSegmenter.ts`:

```typescript
private static readonly MERGE_THRESHOLD = 15; // Aumenta = merge più aggressivo
```

## 🐛 Troubleshooting

### "Model not loaded"

**Problema:** TensorFlow.js non riesce a caricare il modello MNIST.

**Soluzione:**
1. Verifica connessione internet (modello scaricato da Google)
2. Controlla console per errori CORS
3. Attendi qualche secondo dopo il mount del componente

### "Recognition accuracy is low"

**Problema:** Riconoscimento impreciso (<70% confidence).

**Soluzione:**
1. Scrivi più grande (minimo 20x20 px per cifra)
2. Scrivi più chiaro (no sovrapposizioni)
3. Lascia spazio tra simboli (15px minimo)
4. Usa operatori chiari (+, -, ×, ÷)

### "Scribble not detected"

**Problema:** Gesture non riconosciuta.

**Soluzione:**
1. Scarabocchia più velocemente (800+ px/s)
2. Fai più movimenti avanti-indietro (5+ cambi direzione)
3. Abbassa le threshold in `GestureDetector.ts`

### "Canvas undefined"

**Problema:** Canvas passato è null/undefined.

**Soluzione:**
```typescript
if (!canvas) {
  console.error('Canvas is null');
  return;
}

const result = await mathRec.recognize(canvas);
```

## 📊 Performance

### Metriche attese

- **Model loading:** 2-3 secondi (solo al mount)
- **Recognition time:** 200-500ms per espressione
- **Memory usage:** ~50MB (model MNIST)
- **Accuracy:** 75-85% su espressioni semplici

### Ottimizzazioni

1. **Lazy loading:** Model caricato solo quando necessario
2. **Caching:** Riutilizza model tra riconoscimenti
3. **Web Worker:** (opzionale) Sposta riconoscimento in worker

## 🔄 Fallback Strategy

Il sistema usa una strategia di fallback a 3 livelli:

```
1. Math Recognition (TensorFlow.js)
   ↓ se fallisce
2. Tesseract OCR (esistente)
   ↓ se fallisce
3. Input manuale utente
```

Esempio implementazione:

```typescript
async function recognizeWithFallback(canvas: HTMLCanvasElement) {
  // Try Math Recognition
  if (useMathRec && mathRec.isReady) {
    try {
      return await mathRec.recognize(canvas);
    } catch (error) {
      console.warn('Math recognition failed, trying Tesseract...');
    }
  }

  // Fallback to Tesseract
  try {
    return await tesseractRecognize(canvas);
  } catch (error) {
    console.warn('Tesseract failed, manual input required');
    return null;
  }
}
```

## 🚀 Future Improvements

### Possibili miglioramenti futuri:

1. **Training custom model** - Train su dataset italiano
2. **More operators** - Supporto frazioni, radici, potenze
3. **Multi-line expressions** - Equazioni su più righe
4. **Export LaTeX** - Output in formato LaTeX
5. **Web Worker** - Recognition in background thread

## 📝 License

Stesso license del progetto principale.

## 🤝 Contributing

Contributi benvenuti! Aree di miglioramento:

- Migliora accuracy OperatorClassifier
- Aggiungi più gesture (cerchio = cancella tutto, etc)
- Ottimizza SymbolSegmenter per scrittura veloce
- Training model custom su dataset italiano

## 📞 Support

Per problemi o domande:

1. Controlla la sezione Troubleshooting
2. Attiva debug logs nella console
3. Verifica che TensorFlow.js sia installato correttamente
4. Testa su browser moderno (Chrome/Edge/Firefox latest)

---

**Nota:** Questo sistema è ottimizzato per espressioni matematiche semplici. Per riconoscimento più avanzato (frazioni, integrali, matrici) considera MyScript Math (a pagamento).
