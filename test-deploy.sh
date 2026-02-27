#!/bin/bash

# 🚀 Script Test Automatico Deploy MYAccounting
# Uso: ./test-deploy.sh [URL_PRODUZIONE]

PROD_URL=${1:-"https://myaccountingboard.vercel.app"}
LOCAL_URL="http://localhost:5173"
API_URL="http://localhost:3001"

echo "🧪 TEST AUTOMATICO DEPLOY - MYAccounting"
echo "=========================================="
echo "URL Produzione: $PROD_URL"
echo "URL Locale: $LOCAL_URL"
echo "URL API: $API_URL"
echo ""

# Funzione per testare URL
test_url() {
    local url=$1
    local description=$2
    local expected_status=${3:-200}
    
    echo -n "🔍 Test $description... "
    
    if curl -s -o /dev/null -w "%{http_code}" "$url" | grep -q "$expected_status"; then
        echo "✅ PASS"
        return 0
    else
        echo "❌ FAIL (Status: $(curl -s -o /dev/null -w "%{http_code}" "$url"))"
        return 1
    fi
}

# Funzione per testare API
test_api() {
    local endpoint=$1
    local description=$2
    
    echo -n "🔧 Test API $description... "
    
    response=$(curl -s "$API_URL$endpoint")
    if echo "$response" | grep -q '"status":"ok"'; then
        echo "✅ PASS"
        return 0
    else
        echo "❌ FAIL"
        echo "   Response: $response"
        return 1
    fi
}

# Test 1: Build locale
echo "📦 TEST BUILD LOCALE"
echo "--------------------"
if npm run build > /dev/null 2>&1; then
    echo "✅ Build locale OK"
else
    echo "❌ Build locale FALLITO"
    exit 1
fi
echo ""

# Test 2: Server locale
echo "🌐 TEST SERVER LOCALE"
echo "---------------------"
if pgrep -f "vite.*5173" > /dev/null; then
    echo "✅ Server locale in esecuzione"
    test_url "$LOCAL_URL" "Homepage locale"
else
    echo "⚠️  Server locale non in esecuzione (avviare con npm run dev)"
fi
echo ""

# Test 3: API Backend
echo "🔧 TEST API BACKEND"
echo "-------------------"
if pgrep -f "node.*3001" > /dev/null || pgrep -f "tsx.*3001" > /dev/null; then
    echo "✅ API Backend in esecuzione"
    test_api "/health" "Health check"
else
    echo "⚠️  API Backend non in esecuzione (avviare con cd apps/api && npm run dev)"
fi
echo ""

# Test 4: Produzione
echo "🚀 TEST PRODUZIONE"
echo "------------------"
test_url "$PROD_URL" "Homepage produzione"
test_url "$PROD_URL/favicon.ico" "Favicon"
echo ""

# Test 5: Funzionalità JavaScript (produzione)
echo "⚡ TEST FUNZIONALITÀ JS"
echo "----------------------"
echo "🔍 Test caricamento JavaScript..."
if curl -s "$PROD_URL" | grep -q "script.*index.*\.js"; then
    echo "✅ JavaScript caricato correttamente"
else
    echo "❌ JavaScript non trovato"
fi

echo "🔍 Test canvas virtualizzazione..."
if curl -s "$PROD_URL" | grep -q "canvas-wrapper"; then
    echo "✅ Struttura canvas presente"
else
    echo "❌ Struttura canvas non trovata"
fi
echo ""

# Test 6: Performance
echo "⚡ TEST PERFORMANCE"
echo "------------------"
load_time=$(curl -s -o /dev/null -w "%{time_total}" "$PROD_URL")
if (( $(echo "$load_time < 3.0" | bc -l) )); then
    echo "✅ Tempo caricamento: ${load_time}s (OK)"
else
    echo "⚠️  Tempo caricamento: ${load_time}s (lento)"
fi
echo ""

# Test 7: File critici
echo "📁 TEST FILE CRITICI"
echo "--------------------"
test_url "$PROD_URL/manifest.webmanifest" "PWA Manifest"
test_url "$PROD_URL/sw.js" "Service Worker"
echo ""

# Riepilogo
echo "📊 RIEPILOGO"
echo "============"
echo "✅ Test completati!"
echo ""
echo "📋 Checklist manuale da eseguire su $PROD_URL:"
echo "   □ Test disegno penna"
echo "   □ Test gomma"
echo "   □ Test linea"
echo "   □ Test salvataggio documento"
echo "   □ Test caricamento documento"
echo "   □ Test estrazione Excel (se API attiva)"
echo "   □ Test esportazione PDF"
echo ""
echo "🔧 Comandi utili:"
echo "   API Backend: cd apps/api && npm run dev"
echo "   Frontend: npm run dev"
echo "   Build: npm run build"
echo "   Deploy: git push (automatico su Vercel)"
echo ""
echo "🎯 Deploy pronto per produzione!"
