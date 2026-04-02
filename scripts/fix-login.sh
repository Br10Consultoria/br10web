#!/bin/bash
# ─── BR10 NetManager - Fix Login Script ──────────────────────────────────────
# Corrige o problema de autenticação: força git pull e rebuild sem cache
set -e

echo "=== BR10 NetManager - Corrigindo problema de login ==="
cd /opt/br10web

# 1. Forçar git pull descartando mudanças locais
echo "[1/5] Sincronizando código com o repositório..."
git fetch origin main
git reset --hard origin/main
echo "✓ Código atualizado"

# 2. Verificar que o LoginPage.tsx tem a correção
echo "[2/5] Verificando correção no LoginPage..."
if grep -q "Bearer.*result.access_token" frontend/src/pages/LoginPage.tsx; then
    echo "✓ Correção de token presente no LoginPage.tsx"
else
    echo "✗ ERRO: Correção não encontrada! Aplicando manualmente..."
    # Aplicar patch manual se necessário
    sed -i 's|const meResponse = await authApi.me()|const meResponse = await api.get("/auth/me", { headers: { Authorization: `Bearer ${result.access_token}` } })|g' frontend/src/pages/LoginPage.tsx
fi

# 3. Rebuild do frontend SEM cache
echo "[3/5] Rebuilding frontend (sem cache)..."
docker compose build --no-cache frontend
echo "✓ Frontend recompilado"

# 4. Recriar containers
echo "[4/5] Reiniciando containers..."
docker compose up -d --force-recreate frontend nginx
echo "✓ Containers reiniciados"

# 5. Aguardar e testar
echo "[5/5] Aguardando containers ficarem prontos..."
sleep 15

# Testar login via curl
echo ""
echo "=== Testando login ==="
RESULT=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
    -X POST http://localhost/api/v1/auth/login \
    -H "Content-Type: application/json" \
    -d '{"username":"admin","password":"Admin@BR10!"}')

HTTP_STATUS=$(echo "$RESULT" | grep "HTTP_STATUS:" | cut -d: -f2)
BODY=$(echo "$RESULT" | grep -v "HTTP_STATUS:")

echo "HTTP Status: $HTTP_STATUS"
if [ "$HTTP_STATUS" = "200" ]; then
    echo "✓ Login funcionando!"
    echo "$BODY" | python3 -m json.tool 2>/dev/null | head -10
else
    echo "✗ Login ainda com problema. Resposta:"
    echo "$BODY"
    echo ""
    echo "Verificando logs do backend..."
    docker logs br10_backend --tail=20
fi

echo ""
echo "=== Concluído ==="
