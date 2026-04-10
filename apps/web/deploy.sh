#!/bin/bash
# Build e deploy manuale per Vercel
echo "Building..."
npx vite build --mode production

echo "Deploying to Vercel..."
npx vercel --prod --force --name myaccounting-sync-debug
