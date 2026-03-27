# 📝 SNIPPET INTEGRAZIONE App.tsx

## 🎯 Modifiche da fare in apps/web/src/App.tsx

### 1️⃣ IMPORT (all'inizio del file)

Aggiungi dopo gli altri import:

```typescript
import { SyncRoomManager } from './components/SyncRoomManager';
import { useCanvasSyncMultiRoom } from './hooks/useCanvasSyncMultiRoom';
```

---

### 2️⃣ HOOK (nella sezione useState)

Cerca una sezione con altri useState (es. `const [tool, setTool] = useState<Tool>...`)
e aggiungi:

```typescript
// ============================================================
// SYNC MULTI-ROOM
// ============================================================
const {
  isConnected: syncIsConnected,
  currentRoom: syncCurrentRoom,
  latency: syncLatency,
  connectedUsers: syncConnectedUsers,
  joinRoom: syncJoinRoom,
  leaveRoom: syncLeaveRoom
} = useCanvasSyncMultiRoom(
  canvasRef.current,
  `ws://${window.location.hostname}:3001`
);
```

**Note:**
- Funziona in LAN: `window.location.hostname` usa l'IP del PC
- Se vuoi IP fisso: sostituisci con `ws://192.168.1.100:3001`

---

### 3️⃣ COMPONENTE (nel toolbar)

Cerca la sezione del toolbar con i bottoni.
Esempio: cerca qualcosa tipo `<button onClick={...}>Giornale</button>`

Aggiungi il componente Sync **dopo** gli altri bottoni del toolbar:

```typescript
{/* Sync LAN Multi-Room */}
<SyncRoomManager
  isConnected={syncIsConnected}
  currentRoom={syncCurrentRoom}
  latency={syncLatency}
  connectedUsers={syncConnectedUsers}
  onJoinRoom={syncJoinRoom}
  onLeaveRoom={syncLeaveRoom}
/>
```

---

## 🔍 ESEMPIO COMPLETO INTEGRATO

Ecco come dovrebbe apparire la sezione modificata:

```typescript
// ============================================================
// IMPORTS
// ============================================================
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { JournalPanel, type JournalEntry } from "./components/JournalPanel";
import { SyncRoomManager } from './components/SyncRoomManager';  // ← NUOVO
import { useCanvasSyncMultiRoom } from './hooks/useCanvasSyncMultiRoom';  // ← NUOVO
// ... altri import

// ============================================================
// COMPONENT
// ============================================================
function App() {
  // Stati esistenti
  const [tool, setTool] = useState<Tool>("pen");
  const [showJournal, setShowJournal] = useState(false);
  // ... altri stati

  // Sync Multi-Room ← NUOVO
  const {
    isConnected: syncIsConnected,
    currentRoom: syncCurrentRoom,
    latency: syncLatency,
    connectedUsers: syncConnectedUsers,
    joinRoom: syncJoinRoom,
    leaveRoom: syncLeaveRoom
  } = useCanvasSyncMultiRoom(
    canvasRef.current,
    `ws://${window.location.hostname}:3001`
  );

  // ... resto del codice

  return (
    <div className="app-container">
      {/* Toolbar */}
      <div className="toolbar">
        {/* Bottoni esistenti */}
        <button onClick={handleUndo}>Annulla</button>
        <button onClick={handleRedo}>Ripristina</button>
        <button onClick={() => setShowJournal(!showJournal)}>
          Giornale
        </button>

        {/* Sync Multi-Room ← NUOVO */}
        <SyncRoomManager
          isConnected={syncIsConnected}
          currentRoom={syncCurrentRoom}
          latency={syncLatency}
          connectedUsers={syncConnectedUsers}
          onJoinRoom={syncJoinRoom}
          onLeaveRoom={syncLeaveRoom}
        />
      </div>

      {/* ... resto del JSX */}
    </div>
  );
}
```

---

## ⚠️ ATTENZIONE

### Non funziona subito?

1. **Verifica TypeScript types:** Il tipo `canvas` potrebbe dare errore.
   
   **Soluzione:** In `useCanvasSyncMultiRoom.ts`, cambia:
   ```typescript
   export function useCanvasSyncMultiRoom(
     canvas: FabricCanvas | null, // Usa il tipo corretto
     serverUrl: string
   )
   ```

2. **Server non connesso:** 
   - Assicurati che il server sync sia avviato (`npm start` in `apps/sync-server/`)
   - Controlla console browser per errori WebSocket

3. **CSS non applicato:**
   - Verifica che `sync-styles.css` sia stato aggiunto a `apps/web/src/styles.css`

---

## ✅ TEST RAPIDO

Dopo aver fatto le modifiche:

1. Salva tutti i file
2. Riavvia dev server: `npm run dev:lan`
3. Apri browser
4. Dovresti vedere il bottone WiFi nel toolbar
5. Clicca → Si apre modal Sync ✅

---

**Tutto chiaro? Inizia dalle modifiche nell'ordine 1️⃣ → 2️⃣ → 3️⃣!** 🚀
