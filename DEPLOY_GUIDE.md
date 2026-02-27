# 🚀 Guida Deploy Vercel - MYAccounting

## 📋 Checklist Pre-Deploy

### ✅ Verifiche Locali
- [ ] **Build test**: `npm run build` (nessun errore)
- [ ] **Test funzionalità**: Canvas, penna, gomma, linea funzionano
- [ ] **API Backend**: Avviata su `localhost:3001`
- [ ] **Test estrazione**: Excel giornale funziona
- [ ] **Test salvataggio**: Documenti salvati/caricati correttamente

### 🔄 Commit su GitHub
```bash
git add .
git commit -m "messaggio descrittivo"
git push
```

## 🌐 Deploy su Vercel

### 1. Vai su [vercel.com](https://vercel.com)
### 2. Connettiti al tuo account GitHub
### 3. Seleziona il repository: `peppeluk/myaccountingboard`
### 4. Configura il progetto:
   - **Framework**: Vite
   - **Root Directory**: `apps/web`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
   - **Install Command**: `npm install`

### 5. Variabili Environment (se necessarie)
- `VITE_API_BASE_URL`: URL dell'API backend

## 🔄 Procedura Post-Deploy

### ✅ Verifiche su Produzione
- [ ] **Test canvas**: Disegno, penna, gomma funzionano
- [ ] **Test salvataggio**: Documenti si salvano/caricano
- [ ] **Test estrazione**: Excel giornale (se API disponibile)

## 🔧 Manutenzione API Backend

### 🚀 Avvio API (per estrazione Excel)
```bash
cd apps/api
npm run dev
```

### 📋 Configurazione API
- **Porta**: 3001
- **Template**: `./templates/t-smart-template.xlsx`
- **Environment**: Copiare `.env.example` in `.env`

### 🌐 Deploy API (opzionale)
Per deploy produzione dell'API:
- Usare Vercel/Railway/Render
- Configurare variabili environment
- Aggiornare `VITE_API_BASE_URL` nel frontend

## 🚨 Troubleshooting Comuni

### Canvas non visibili
```bash
# Controlla posizionamento canvas
document.querySelectorAll('canvas').forEach((c,i)=>console.log(i,c.getBoundingClientRect()))
```

### API non risponde
```bash
# Verifica health endpoint
curl http://localhost:3001/health
```

### Build fallisce
```bash
# Pulisci e rebuild
npm run clean
npm install
npm run build
```

## 📝 Note Importanti

1. **API Backend**: Necessaria solo per estrazione Excel giornale
2. **Canvas Virtualizzazione**: Sistema ottimizzato per performance
3. **Multi-canvas**: Ogni pagina ha canvas separati per velocità
4. **Persistenza**: Documenti salvati in IndexedDB locale

## 🔄 Workflow Futuro

1. **Sviluppo locale** → Test completi
2. **Build test** → `npm run build`
3. **Commit** → `git add . && git commit && git push`
4. **Deploy** → Vercel automatico
5. **Verifica** → Test su produzione

---

*Ultimo aggiornamento: 26 Feb 2026*
*Stato: ✅ Pronto per deploy*
