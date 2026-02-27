# ⚡ Test Rapido Deploy - Comandi Essenziali

## 🚀 PowerShell (Windows)
```powershell
# Test completo
.\test-deploy.ps1

# Test solo produzione
.\test-deploy.ps1 "https://myaccountingboard.vercel.app"
```

## 🐧 Bash (Linux/Mac)
```bash
# Test completo
chmod +x test-deploy.sh
./test-deploy.sh

# Test solo produzione
./test-deploy.sh "https://myaccountingboard.vercel.app"
```

## 🔍 Test Manuali Veloci

### Produzione
```bash
# Test base
curl -I https://myaccountingboard.vercel.app

# Test JavaScript
curl -s https://myaccountingboard.vercel.app | grep -o "index-.*\.js"
```

### Locale
```bash
# Build
npm run build

# API Health
curl http://localhost:3001/health

# Frontend
curl -I http://localhost:5173
```

## 📋 Checklist 30 secondi

### ✅ Automatici (script)
- [ ] Build OK
- [ ] Produzione raggiungibile
- [ ] API attiva (se necessario)
- [ ] Performance < 3s

### 🔍 Manuali (browser)
- [ ] Canvas funzionante
- [ ] Salvataggio OK
- [ ] PDF si esporta
- [ ] Excel si estrae (API)

## 🚨 Allarme Problemi

### Build fallisce
```bash
npm run clean
npm install
npm run build
```

### Canvas non visibili
```javascript
// Nella console
document.querySelectorAll('canvas').forEach((c,i)=>console.log(i,c.getBoundingClientRect()))
```

### API non risponde
```bash
cd apps/api && npm run dev
```

---

*Tempo totale test: ~2 minuti automatici + 1 minuto manuali*
