# MyScript (archivio)

Questo folder contiene il materiale per reintegrare la scrittura a mano MyScript.

## Env vars
Aggiungere in `.env` (o `.env.local`) i valori necessari:

```bash
VITE_MYSCRIPT_APP_KEY=your-application-key
VITE_MYSCRIPT_HMAC_KEY=your-hmac-key
VITE_MYSCRIPT_HOST=cloud.myscript.com
VITE_MYSCRIPT_LANG=it_IT
VITE_MYSCRIPT_EDITOR_TYPE=INTERACTIVEINKSSR
VITE_MYSCRIPT_SCRIPT_URL=https://cdn.jsdelivr.net/npm/iink-ts@3.2.1/dist/iink.min.js
```

## Dependency
In `web/package.json`:

```json
"iink-ts": "^3.2.1"
```

## App.tsx (snippets)
Import e configurazione:

```tsx
import { MyScriptInkInput } from "./components/MyScriptInkInput";

const IS_MYSCRIPT_CONFIGURED = Boolean(
  import.meta.env.VITE_MYSCRIPT_APP_KEY && import.meta.env.VITE_MYSCRIPT_HMAC_KEY
);
```

State:

```tsx
const [isHandwritingEnabled, setIsHandwritingEnabled] = useState(() => IS_MYSCRIPT_CONFIGURED);
const [myScriptTestValue, setMyScriptTestValue] = useState("");
```

Toolbar toggle:

```tsx
{IS_MYSCRIPT_CONFIGURED && (
  <button
    className={`icon-button ${isHandwritingEnabled ? "active" : ""}`}
    title={isHandwritingEnabled ? "Scrittura a mano attiva" : "Scrittura a mano disattivata"}
    aria-label={isHandwritingEnabled ? "Disattiva scrittura a mano" : "Attiva scrittura a mano"}
    type="button"
    onClick={() => setIsHandwritingEnabled((value) => !value)}
  >
    <i className="fa-solid fa-pen-nib" />
    <span className="sr-only">
      {isHandwritingEnabled ? "Disattiva scrittura a mano" : "Attiva scrittura a mano"}
    </span>
  </button>
)}
```

Test panel:

```tsx
{IS_MYSCRIPT_CONFIGURED && (
  <section
    className="myscript-test-panel"
    aria-label="Campo di prova MyScript"
    onPointerDown={(event) => event.stopPropagation()}
    onPointerMove={(event) => event.stopPropagation()}
    onPointerUp={(event) => event.stopPropagation()}
  >
    <header className="myscript-test-header">
      <strong>Prova MyScript</strong>
      <span>Scrivi qui per testare il riconoscimento</span>
    </header>
    <div className="myscript-test-input">
      <MyScriptInkInput
        value={myScriptTestValue}
        onValueChange={setMyScriptTestValue}
        handwritingEnabled={isHandwritingEnabled}
        placeholder="Scrivi qui..."
        inputMode={disableSystemKeyboard ? "none" : "text"}
        readOnly={disableSystemKeyboard}
      />
    </div>
  </section>
)}
```

Prop sul `JournalPanel`:

```tsx
<JournalPanel
  ...
  handwritingEnabled={isHandwritingEnabled}
/>
```

## JournalPanel.tsx (snippets)
Import:

```tsx
import { MyScriptInkInput } from "./MyScriptInkInput";
```

Props:

```tsx
type JournalPanelProps = {
  ...
  handwritingEnabled?: boolean;
};

type AccountPickerProps = {
  ...
  handwritingEnabled?: boolean;
};
```

AccountPicker: state e openInkPad, e uso nei click (seguire il file originale per i dettagli).

Popover:

```tsx
{handwritingEnabled && isInkOpen && (
  <div className="account-ink-popover" role="dialog" aria-label="Scrittura conto">
    <header className="account-ink-header">
      <strong>Scrivi il conto</strong>
      <button
        type="button"
        className="icon-button"
        aria-label="Chiudi scrittura"
        onClick={() => setIsInkOpen(false)}
      >
        <i className="fa-solid fa-xmark" />
      </button>
    </header>
    <div className="account-ink-input">
      <MyScriptInkInput
        value={query}
        onValueChange={(nextValue) => handleInputChange(nextValue)}
        handwritingEnabled={handwritingEnabled}
        forceExportOnPointerUp
        renderingMinWidth={360}
        renderingMinHeight={160}
        placeholder="Scrivi il conto..."
        inputMode="none"
        readOnly
      />
    </div>
    <p className="account-ink-hint">Il testo riconosciuto aggiorna la ricerca del conto.</p>
  </div>
)}
```

## Styles
Vedi `styles.myscript.css` e reinserire i blocchi in `web/src/styles.css`.
