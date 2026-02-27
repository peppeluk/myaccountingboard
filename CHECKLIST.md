# 🚀 CHECKLIST COMPLETA DEPLOY

## 🌐 PRODUZIONE (https://accamora.vercel.app)

### ✅ Test Automatici
```powershell
# Status web
(Invoke-WebRequest -Uri 'https://accamora.vercel.app/' -UseBasicParsing).StatusCode

# Canvas structure
((Invoke-WebRequest -Uri 'https://accamora.vercel.app/' -UseBasicParsing).Content).Contains('canvas-wrapper')
```

### 🔍 Test Manuali (Browser)
- [ ] **Canvas visibile** - Lavagna appare correttamente
- [ ] **Penna funzionante** - Disegna linee fluide
- [ ] **Gomma funzionante** - Cancella correttamente
- [ ] **Linea funzionante** - Traccia rette precise
- [ ] **Salvataggio documento** - Salva in IndexedDB
- [ ] **Caricamento documento** - Recupera salvataggi
- [ ] **Esportazione PDF** - Download file PDF
- [ ] **Multi-pagina** - Scorrimento tra pagine
- [ ] **Journal funzionante** - Inserimento voci

## 🔧 API BACKEND (localhost:3001)

### ✅ Test Automatici
```powershell
# Health check
(Invoke-RestMethod -Uri 'http://localhost:3001/health' -UseBasicParsing).status

# Template file
Test-Path './apps/api/templates/t-smart-template.xlsx'
```

### 🔍 Test Manuali
- [ ] **API avviata** - `cd apps/api && npm run dev`
- [ ] **Health endpoint** - Risponde con status "ok"
- [ ] **Export endpoint** - POST `/api/journal/export` funziona
- [ ] **Template Excel** - File presente e valido
- [ ] **Environment** - `.env` configurato correttamente

## 🔗 INTEGRAZIONE COMPLETA

### 📋 Flusso Completo
1. **Avvio API**: `cd apps/api && npm run dev`
2. **Apri Web**: `https://accamora.vercel.app`
3. **Test disegno**: Penna, gomma, linea
4. **Test salvataggio**: Documento salvato
5. **Test giornale**: Inserisci alcune voci
6. **Test Excel**: Estrai dati giornale
7. **Test PDF**: Esporta documento

### 🚨 Allarme Problemi

#### Canvas non funziona
```javascript
// Console browser
document.querySelectorAll('canvas').forEach((c,i)=>console.log(i,c.getBoundingClientRect()))
```

#### API non risponde
```bash
# Avvio API
cd apps/api && npm run dev

# Health check
curl http://localhost:3001/health
```

#### Export Excel fallito
```bash
# Verifica template
ls -la apps/api/templates/

# Verifica environment
cat apps/api/.env
```

## 🔄 WORKFLOW FUTURO

### Prima di ogni deploy
1. **Test locale completo**
2. **Build test**: `npm run build`
3. **API test**: Health + export
4. **Commit**: `git add . && git commit && git push`

### Post-deploy
1. **Test produzione**: Canvas + funzionalità
2. **Test integrazione**: Excel export
3. **Performance check**: Load time < 3s

---

*Stato attuale: ✅ Pronto per produzione*
