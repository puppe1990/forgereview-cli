#!/bin/bash
# Gera binários standalone (não precisa de Node.js instalado)

npm install -g pkg

# Build para todas plataformas
pkg . \
  --targets node18-linux-x64,node18-macos-x64,node18-win-x64 \
  --output dist/forgereview

echo "✅ Binários criados em dist/"
echo "  - dist/forgereview-linux"
echo "  - dist/forgereview-macos"  
echo "  - dist/forgereview-win.exe"

