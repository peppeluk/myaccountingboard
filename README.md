# MYAccounting - New Base (React + Redis)

Base pulita per evolvere la tua app lavagna/calcoli con attenzione a velocita e manutenibilita.

## Architettura

- `apps/web`: React + Vite + TypeScript
- `apps/api`: Fastify + Redis (con fallback automatico in-memory se Redis non disponibile)

I file HTML/JS legacy nella root restano invariati per confronto.

## Stato Migrazione Frontend

La lavagna e stata migrata in `apps/web` con queste funzioni gia operative:

- disegno con penna, gomma e linea
- pagine multiple con persistenza locale
- undo/redo
- selezione area OCR su canvas
- calcolatrice integrata (con riconoscimento operazioni OCR)
- export PDF multipagina

Nota performance: OCR/PDF/calcolo sono caricati in lazy-loading. Rimane un chunk grande dovuto al motore canvas/OCR, ma il bootstrap iniziale e stato ridotto.

## Prerequisiti

- Node.js 20+
- Redis (opzionale in locale, consigliato in produzione)

## Setup rapido

```bash
npm install
```

Opzionale: copia i file `.env.example`:

- `apps/api/.env.example` -> `apps/api/.env`
- `apps/web/.env.example` -> `apps/web/.env`

## Avvio in sviluppo

```bash
npm run dev
```

## Test PWA su mobile

Per testare installazione PWA da telefono serve un URL HTTPS. E disponibile uno script pronto:

```bash
npm run pwa:test
```

Cosa fa:

- build del frontend (`apps/web`)
- avvio preview su porta `4173`
- apertura tunnel HTTPS pubblico con LocalTunnel

Quando parte, in console trovi un URL `https://...loca.lt`: aprilo dal telefono.

Installazione:

- Android (Chrome): menu browser -> `Installa app` / `Aggiungi a schermata Home`
- iPhone (Safari): Condividi -> `Aggiungi alla schermata Home`

Note utili:

- se il tunnel cambia URL, riapri il nuovo link sul telefono
- per test rapido su rete locale senza installazione PWA puoi usare: `npm run dev:lan --workspace @myaccounting/web`

Endpoints principali API:

- `GET /health`
- `PUT /api/cache/:key`
- `GET /api/cache/:key`
- `POST /api/journal/export` (estrae file `.xlsx` compilando `LIBRO_GIORNALE` da `giornale_data`)

## Export giornale_data -> Excel

1. Copia il template Excel in `apps/api/templates/t-smart-template.xlsx`
2. In alternativa imposta `JOURNAL_TEMPLATE_PATH` in `apps/api/.env`
3. Apri in app il pannello `giornale_data` e usa `Estrai .xlsx`
4. Per deploy Vercel API, il template deve essere presente nel repository (oppure disponibile su path configurato in runtime)

Nota tecnica: il nome del pannello in app e `giornale_data`, ma il foglio tecnico nel file resta `LIBRO_GIORNALE` per mantenere compatibili le formule degli altri fogli.

## Deploy automatico Vercel

Workflow presenti:

- Web: `.github/workflows/vercel-prod.yml`
- API: `.github/workflows/vercel-api-prod.yml`

Secret GitHub richiesti:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_API_PROJECT_ID` (solo API)

Variabili ambiente Vercel consigliate:

- progetto API:
  - `CORS_ORIGIN=https://<tuo-dominio-web>`
  - `JOURNAL_TEMPLATE_PATH=./templates/t-smart-template.xlsx`
  - `REDIS_URL` (opzionale, fallback automatico in-memory)
- progetto Web:
  - `VITE_API_BASE_URL=https://<dominio-api-vercel>`

## Qualita codice

```bash
npm run lint
npm run typecheck
npm run build
```

## Prossimi step consigliati

1. Portare la logica lavagna/OCR nel frontend React in moduli separati.
2. Salvare stato pagine e sessioni in Redis con chiavi per utente/documento.
3. Aggiungere test API e E2E (Vitest + Playwright).
