# 🚀 GUIDA INTEGRAZIONE SYNC MULTI-ROOM - MyAccounting

## 📦 File Forniti

```
integration/
├── useCanvasSyncMultiRoom.ts    → Hook React sync
├── SyncRoomManager.tsx          → Componente UI
├── sync-styles.css              → Stili CSS
├── server-multiroom.js          → Server WebSocket
└── package.json                 → Dipendenze server
```

---

## ⚡ SETUP RAPIDO (15 minuti)

### Step 1: Setup Server Sync (5 minuti)

```bash
# Dalla root del progetto
mkdir -p apps/sync-server
cd apps/sync-server

# Copia file
cp ../integration/package.json .
cp ../integration/server-multiroom.js server.js

# Installa dipendenze
npm install

# Avvia server
npm start
```

**Verifica:** Dovresti vedere:
```
🚀 Sync Server (Multi-Room) running on port 3001
   - Mode: Multi-Room
   - User Tracking: Enabled
```

---

### Step 2: Integra Frontend (10 minuti)

#### 2.1 Copia File

```bash
# Hook
cp integration/useCanvasSyncMultiRoom.ts apps/web/src/hooks/

# Componente
cp integration/SyncRoomManager.tsx apps/web/src/components/

# CSS
cat integration/sync-styles.css >> apps/web/src/styles.css
```

#### 2.2 Modifica App.tsx

**File:** `apps/web/src/App.tsx`

**A) Aggiungi Import** (all'inizio del file):

```typescript
import { SyncRoomManager } from './components/SyncRoomManager';
import { useCanvasSyncMultiRoom } from './hooks/useCanvasSyncMultiRoom';
```

**B) Aggiungi Hook** (dopo gli altri useState, cerca la sezione con `const [tool, setTool] = useState<Tool>...`):

```typescript
// Sync Multi-Room
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

**C) Aggiungi Componente nel Toolbar** (cerca la sezione con i bottoni del toolbar, es. dopo il bottone "Giornale"):

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

### Step 3: Test (2 minuti)

#### Avvia App

```bash
# Terminale 1 - Server Sync
cd apps/sync-server
npm start

# Terminale 2 - App Web
cd apps/web
npm run dev:lan
```

#### Verifica IP

```bash
# Windows
ipconfig

# Mac/Linux
ifconfig
```

Esempio IP: `192.168.1.100`

#### Test Multi-Dispositivo

**Dispositivo 1 (PC principale):**
1. Apri `http://localhost:5173`
2. Clicca bottone "Sync" (wifi icon)
3. Nome: "Prof. Rossi"
4. Stanza: "aula-1a"
5. Clicca "Entra"

**Dispositivo 2 (tablet/altro PC):**
1. Apri `http://192.168.1.100:5173`
2. Clicca bottone "Sync"
3. Nome: "LIM Aula 1"
4. Stanza: "aula-1a"
5. Clicca "Entra"

**Risultato:** Disegna su uno → Appare sull'altro! 🎉

---

## 🎓 CASO D'USO: Gestione Aule Multiple

### Scenario: Docente con 3 Ore in 3 Aule

**8:00 - Prima Ora (Aula 1A)**

```
PC Docente:
  1. Clicca "Sync"
  2. Nome: "Prof. Rossi"
  3. Stanza: "aula-1a"
  4. Entra

LIM Aula 1A:
  1. Clicca "Sync"
  2. Nome: "LIM 1A"
  3. Stanza: "aula-1a"
  4. Entra

✅ Sincronizzati: PC ↔ LIM 1A
```

**9:00 - Cambio Aula → Aula 2B**

```
PC Docente:
  1. Clicca "Sync"
  2. Clicca "Disconnetti"
  3. Clicca "Sync" di nuovo
  4. Stanza: "aula-2b"
  5. Entra

LIM Aula 2B:
  1. Clicca "Sync"
  2. Stanza: "aula-2b"
  3. Entra

✅ Sincronizzati: PC ↔ LIM 2B
❌ NON sincronizzato: LIM 1A (stanza diversa)
```

**10:00 - Terza Ora (Laboratorio)**

```
PC Docente:
  1. Clicca "Sync"
  2. Disconnetti
  3. Stanza: "laboratorio"
  4. Entra

5x Tablet:
  - Tutti entrano in "laboratorio"

✅ Sincronizzati: PC ↔ 5 Tablet
❌ NON sincronizzati: LIM 1A, LIM 2B
```

**PROBLEMA RISOLTO!** ✅

---

## 🎨 UI Overview

### Bottone Sync (nel Toolbar)

```
Non connesso: [📡 Wi-Fi icon]
Connesso:     [📡 Wi-Fi icon ● 25ms]
```

### Modal Sync

**Se NON connesso:**
```
┌────────────────────────────┐
│ 👤 Nome: Prof. Rossi       │
│ 🚪 Stanza: aula-1a         │
│ [▶ Entra]                  │
│                            │
│ ─── oppure ───             │
│                            │
│ [⚡ Stanze Rapide ▼]       │
│  🏫 Aula 1A  🏫 Aula 2B    │
│  💻 Lab      🎓 Magna      │
└────────────────────────────┘
```

**Se CONNESSO:**
```
┌────────────────────────────┐
│ ✓ Connesso: aula-1a        │
│ ⚡ Latenza: 25ms           │
│                            │
│ 👥 Dispositivi (3)         │
│  ├─ Prof. Rossi            │
│  ├─ LIM Aula 1A            │
│  └─ Tablet Mario           │
│                            │
│ [🚪 Disconnetti]           │
└────────────────────────────┘
```

### Indicatore Mini (sempre visibile)

In basso a destra quando connesso:

```
┌──────────────┐
│ ● aula-1a 👥3│
└──────────────┘
```

---

## 🔧 PERSONALIZZAZIONE

### Modifica Stanze Rapide

**File:** `apps/web/src/components/SyncRoomManager.tsx`

Cerca e modifica:

```typescript
const quickRooms = [
  { id: 'aula-1a', label: 'Aula 1A', icon: '🏫' },
  { id: 'aula-2b', label: 'Aula 2B', icon: '🏫' },
  { id: 'aula-3c', label: 'Aula 3C', icon: '🏫' },
  { id: 'laboratorio', label: 'Laboratorio', icon: '💻' },
  { id: 'aula-magna', label: 'Aula Magna', icon: '🎓' }
];
```

Cambia con le tue aule:

```typescript
const quickRooms = [
  { id: 'classe-5a', label: 'Classe 5A', icon: '🏫' },
  { id: 'classe-5b', label: 'Classe 5B', icon: '🏫' },
  { id: 'lab-info', label: 'Lab Informatica', icon: '💻' },
  { id: 'auditorium', label: 'Auditorium', icon: '🎭' }
];
```

### IP Fisso Server

Se vuoi usare IP fisso invece di `window.location.hostname`:

**File:** `apps/web/src/App.tsx`

Modifica hook:

```typescript
const SYNC_SERVER_IP = '192.168.1.100'; // Il tuo IP fisso

useCanvasSyncMultiRoom(
  canvasRef.current,
  `ws://${SYNC_SERVER_IP}:3001`
);
```

---

## 📊 MONITORING

### Verifica Stanze Attive

```bash
curl http://localhost:3001/rooms
```

Risposta:
```json
{
  "rooms": [
    {
      "roomId": "aula-1a",
      "clientCount": 2,
      "clients": [
        {"nickname": "Prof. Rossi"},
        {"nickname": "LIM 1A"}
      ]
    }
  ]
}
```

### Health Check

```bash
curl http://localhost:3001/health
```

---

## 🐛 TROUBLESHOOTING

### Server non parte

**Problema:** Porta 3001 occupata

```bash
# Windows
netstat -ano | findstr :3001
taskkill /PID xxxx /F

# Linux/Mac
lsof -ti:3001 | xargs kill -9
```

### Firewall blocca

```bash
# Windows
netsh advfirewall firewall add rule name="Sync Server" dir=in action=allow protocol=TCP localport=3001

# Linux
sudo ufw allow 3001/tcp
```

### Dispositivo 2 non si connette

1. Verifica IP: `ipconfig` / `ifconfig`
2. Ping: `ping 192.168.1.100`
3. Verifica server attivo: `curl http://192.168.1.100:3001/health`
4. Controlla firewall

### TypeScript Errors

Se TypeScript protesta per i tipi:

**File:** `apps/web/src/hooks/useCanvasSyncMultiRoom.ts`

Cambia la firma del tipo canvas:

```typescript
export function useCanvasSyncMultiRoom(
  canvas: FabricCanvas | null, // Usa il tipo corretto dal tuo progetto
  serverUrl: string
)
```

---

## 🚀 DEPLOY PRODUZIONE

### Opzione 1: Server su Raspberry Pi

```bash
# Su Raspberry Pi
git clone <tuo-repo>
cd apps/sync-server
npm install

# Avvia all'avvio
npm install -g pm2
pm2 start server.js --name sync
pm2 startup
pm2 save
```

IP fisso Pi: Configura nel router (es: `192.168.1.50`)

### Opzione 2: Docker

**File:** `apps/sync-server/Dockerfile`

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY server.js ./
EXPOSE 3001
CMD ["node", "server.js"]
```

Build e run:
```bash
cd apps/sync-server
docker build -t sync-server .
docker run -d -p 3001:3001 --restart always sync-server
```

---

## ✅ CHECKLIST FINALE

Setup completato:

- [ ] Server sync installato
- [ ] Server avviato (vedi "Multi-Room" in console)
- [ ] Hook copiato in `apps/web/src/hooks/`
- [ ] Componente copiato in `apps/web/src/components/`
- [ ] CSS aggiunto in `apps/web/src/styles.css`
- [ ] App.tsx modificato (import, hook, componente)
- [ ] Test: entra in stanza → vedi nome stanza
- [ ] Test: 2° dispositivo stessa stanza → vedi "Dispositivi (2)"
- [ ] Test: disconnetti → nome stanza sparisce
- [ ] Test: stanze diverse → isolate tra loro

---

## 🎯 RISULTATO FINALE

Con questa integrazione hai:

✅ **Sincronizzazione LAN** ultra-veloce (15-50ms)  
✅ **Stanze separate** per ogni aula  
✅ **Gestione flessibile** dei dispositivi  
✅ **Cambio aula** in 2 click  
✅ **Tracciamento utenti** per stanza  
✅ **Zero configurazione cloud**  

Il tuo scenario **"prima ora aula A, seconda ora aula B"** è completamente risolto! 🎉

---

## 📚 STRUTTURA FILE FINALE

```
apps/
├── sync-server/           ← NUOVO
│   ├── package.json
│   ├── server.js
│   └── node_modules/
│
└── web/
    └── src/
        ├── hooks/
        │   └── useCanvasSyncMultiRoom.ts  ← NUOVO
        ├── components/
        │   ├── SyncRoomManager.tsx        ← NUOVO
        │   └── ...altri
        ├── styles.css     ← MODIFICATO (CSS aggiunto)
        └── App.tsx        ← MODIFICATO (hook + componente)
```

---

## 🆘 SUPPORTO

**Test rapido:**
```bash
# Verifica server
curl http://localhost:3001/health

# Verifica stanze
curl http://localhost:3001/rooms
```

**Problemi comuni:**
- Non si connette → Verifica firewall e IP
- TypeScript errori → Verifica import tipi
- Server non parte → Verifica porta 3001 libera

---

**Buon sync!** 🚀
