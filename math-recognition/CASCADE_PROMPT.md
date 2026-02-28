# 🎯 PROMPT PER CASCADE - Math Recognition Integration

## OBIETTIVO
Integrare sistema Math Recognition in MYAccounting app esistente senza breaking changes.

## FILES OVERVIEW
Tutti i file sono già pronti nella cartella `math-recognition/`:
- ✅ MathRecognizer.ts - Core recognition con TensorFlow.js
- ✅ GestureDetector.ts - Scribble-to-delete detection
- ✅ SymbolSegmenter.ts - Segmentazione simboli individuali
- ✅ OperatorClassifier.ts - Pattern matching operatori
- ✅ useMathRecognition.ts - React hook
- ✅ types.ts - TypeScript definitions
- ✅ index.ts - Module exports
- ✅ README.md - Documentazione completa
- ✅ INTEGRATION_EXAMPLE.ts - Esempi step-by-step

## 📦 INSTALLATION STEPS

### 1. Install Dependencies
```bash
npm install @tensorflow/tfjs
```

### 2. Copy Module
Copia l'intera cartella `math-recognition/` in:
```
apps/web/src/features/math-recognition/
```

### 3. Integrate in App.tsx

**A. Add Import (top of file)**
```typescript
import { useMathRecognition } from './features/math-recognition';
```

**B. Add States (inside App component)**
```typescript
const [useMathRec, setUseMathRec] = useState(false);
const mathRec = useMathRecognition();
```

**C. Wrap OCR Logic**
Trova la funzione che esegue OCR e wrappa così:

```typescript
const performRecognition = useCallback(async (canvas: HTMLCanvasElement) => {
  // NEW: Try Math Recognition first
  if (useMathRec && mathRec.isReady) {
    try {
      const result = await mathRec.recognize(canvas);
      setDisplay(result.expression);
      setOcrStatus(`Math: ${(result.confidence * 100).toFixed(0)}%`);
      return;
    } catch (error) {
      console.error('Math recognition failed, fallback to Tesseract:', error);
      // Continue to Tesseract below
    }
  }

  // EXISTING: Tesseract logic (unchanged)
  // ... your existing Tesseract code ...
}, [useMathRec, mathRec]);
```

**D. Add Toggle Button**
Nella toolbar, aggiungi:

```typescript
<button
  className={`icon-button ${useMathRec ? 'active' : ''}`}
  onClick={() => setUseMathRec(!useMathRec)}
  title={useMathRec ? 'Math Recognition ON' : 'Math Recognition OFF'}
  type="button"
>
  <i className={`fa-solid ${useMathRec ? 'fa-calculator' : 'fa-font'}`} />
</button>
```

## 🎨 CSS (add to styles.css)

```css
.icon-button.active {
  background: var(--primary-color, #3b82f6);
  color: white;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
}
```

## ✅ CRITICAL SUCCESS CRITERIA

1. ✅ **ZERO Breaking Changes** - Existing code unchanged
2. ✅ **Feature Flag** - Toggle on/off without errors
3. ✅ **Fallback Works** - Returns to Tesseract if Math fails
4. ✅ **No Console Errors** - Clean execution
5. ✅ **Performance OK** - Recognition <500ms

## 🧪 TESTING CHECKLIST

After integration, test:

```
✅ 1. Toggle button visible and clickable
✅ 2. Write "2+3" → displays "2+3"
✅ 3. Write "12x5" → displays "12x5"
✅ 4. Console shows: [MathRecognizer] Result: "2+3"
✅ 5. Toggle OFF → Tesseract works
✅ 6. No errors in console
✅ 7. App still loads correctly
✅ 8. Calculator receives correct input
```

## 🚨 POTENTIAL ISSUES & SOLUTIONS

### Issue: "Cannot find module '@tensorflow/tfjs'"
**Solution:**
```bash
cd apps/web
npm install @tensorflow/tfjs
```

### Issue: "Model loading takes too long"
**Solution:** This is normal. First load takes 2-3 seconds to download MNIST model from Google.

### Issue: "Low recognition accuracy"
**Solution:**
- Write larger (min 20x20px per digit)
- Leave space between symbols (15px+)
- Write clearly and slowly

### Issue: "Canvas is undefined"
**Solution:** Add null check:
```typescript
if (!canvas) {
  console.error('Canvas is null');
  return;
}
```

## 📁 FILE STRUCTURE AFTER INTEGRATION

```
apps/web/src/
├── features/
│   └── math-recognition/           ← NEW
│       ├── index.ts
│       ├── MathRecognizer.ts
│       ├── GestureDetector.ts
│       ├── SymbolSegmenter.ts
│       ├── OperatorClassifier.ts
│       ├── useMathRecognition.ts
│       ├── types.ts
│       └── README.md
├── App.tsx                         ← MODIFIED (minimal changes)
└── styles.css                      ← MODIFIED (add CSS)
```

## 🎯 MINIMAL CHANGES TO APP.TSX

Solo 3 piccole modifiche:

```diff
+ import { useMathRecognition } from './features/math-recognition';

  function App() {
+   const [useMathRec, setUseMathRec] = useState(false);
+   const mathRec = useMathRecognition();

    const performOCR = async (canvas) => {
+     if (useMathRec && mathRec.isReady) {
+       try {
+         const result = await mathRec.recognize(canvas);
+         setDisplay(result.expression);
+         return;
+       } catch (e) {
+         console.error('Math failed:', e);
+       }
+     }
      
      // Existing Tesseract code unchanged
    };

    return (
      <div className="toolbar">
+       <button onClick={() => setUseMathRec(!useMathRec)}>
+         <i className={`fa-solid ${useMathRec ? 'fa-calculator' : 'fa-font'}`} />
+       </button>
      </div>
    );
  }
```

## 💡 IMPLEMENTATION STRATEGY

**Phase 1: Basic Integration (30 min)**
1. Install @tensorflow/tfjs
2. Copy math-recognition folder
3. Add import + state in App.tsx
4. Add toggle button
5. Test toggle works

**Phase 2: OCR Integration (30 min)**
1. Wrap OCR logic with Math Recognition
2. Test recognition works
3. Verify fallback to Tesseract

**Phase 3: Polish (30 min)**
1. Add CSS styling
2. Add status indicators
3. Test edge cases
4. Add error handling

**Total Time: ~1.5 hours**

## 🚀 DEPLOYMENT CHECKLIST

Before deploying:

```
✅ All files copied correctly
✅ npm install completed
✅ No TypeScript errors
✅ App builds successfully
✅ Feature flag defaults to OFF
✅ Tesseract still works when OFF
✅ Math Recognition works when ON
✅ No console errors
✅ Performance acceptable
```

## 📞 SUPPORT

If issues arise:

1. Check INTEGRATION_EXAMPLE.ts for detailed examples
2. Read README.md for full documentation
3. Enable debug logs in browser console
4. Verify @tensorflow/tfjs is installed
5. Test on Chrome/Edge/Firefox (latest versions)

## 🎉 SUCCESS CRITERIA

You'll know it's working when:

1. ✅ Toggle button appears in toolbar
2. ✅ Clicking toggle changes icon
3. ✅ Writing "2+3" shows in calculator
4. ✅ Console shows: `[MathRecognizer] Result: "2+3"`
5. ✅ Confidence shown: `Math: 85%`
6. ✅ Toggle OFF returns to Tesseract
7. ✅ No breaking changes to existing features

---

**READY TO IMPLEMENT!** 🚀

Follow the steps above and refer to INTEGRATION_EXAMPLE.ts for detailed code examples.
