#!/usr/bin/env bash
# cleanup-project.sh — Remove arquivos desnecessários do projeto tickrify
# Execute da raiz do projeto: bash scripts/cleanup-project.sh

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "🧹 Limpando projeto tickrify..."
echo ""

# ── Raiz ──────────────────────────────────────────────────────────────────────

echo "📦 [1/5] Removendo package-lock.json (monorepo usa pnpm, não npm)..."
rm -f package-lock.json

echo "🗂️  [2/5] Removendo .tmp/ (scripts de debug temporários)..."
rm -rf .tmp

echo "📋 [3/5] Removendo logs/ e test-results/ (artifacts de runtime)..."
rm -rf logs test-results

echo "🖼️  [4/5] Renomeando tickrify.img/ → brand/ ..."
if [ -d "tickrify.img" ]; then
  mv "tickrify.img" "brand"
  echo "   ✓ Renomeado para brand/"
fi

# ── docs/archive ──────────────────────────────────────────────────────────────

echo "📚 [5/5] Removendo docs/archive/ (19 documentos obsoletos)..."
rm -rf docs/archive

# ── docs/backend — manter apenas ENV_VARIABLES.md e PROMPTS.md ───────────────

echo "📄 Limpando docs/backend/ (mantendo ENV_VARIABLES.md e PROMPTS.md)..."
find docs/backend -type f -name "*.md" \
  ! -name "ENV_VARIABLES.md" \
  ! -name "PROMPTS.md" \
  -delete
echo "   ✓ Removidos docs redundantes de deploy"

# ── Frontend ──────────────────────────────────────────────────────────────────

echo "🎨 Removendo App.css (boilerplate Vite não importado)..."
rm -f apps/frontend/src/App.css

echo "🔧 Removendo .gitignore duplicado (com espaço no nome)..."
rm -f "apps/frontend/.gitignore 2"

# ── Scripts de deploy redundantes ─────────────────────────────────────────────

echo "🚀 Removendo scripts de deploy redundantes..."
rm -f scripts/deploy-vercel-completo.sh
rm -f scripts/deploy-railway.sh
rm -f scripts/deploy-vercel.sh
echo "   ✓ Mantendo apenas deploy-prod.sh, check-deploy.sh, smoke*.sh"

# ── Infra: mover para infra/ ──────────────────────────────────────────────────

echo ""
echo "📁 Movendo arquivos de infra para infra/ ..."
mkdir -p infra
for f in Dockerfile Dockerfile.worker docker-entrypoint.sh Procfile; do
  if [ -f "$f" ]; then
    mv "$f" "infra/$f"
    echo "   ✓ $f → infra/$f"
  fi
done

echo ""
echo "✅ Limpeza concluída!"
echo ""
echo "⚠️  ATENÇÃO: Se usar Railway/Render, atualize as configs para apontar"
echo "   para infra/Dockerfile e infra/Procfile (verifique railway.json e render.yaml)"
echo ""
echo "📊 Estrutura final da raiz:"
ls -1 --color=never | grep -v "node_modules\|\.git\|\.pnpm"
