#!/usr/bin/env bash
# Adiciona sua chave SSH ao GitHub automaticamente via API.
# Uso: GITHUB_TOKEN=seu_token_aqui ./scripts/add-ssh-key-to-github.sh
# Crie o token em: https://github.com/settings/tokens (scope: admin:public_key)

set -e
KEY_FILE="${HOME}/.ssh/id_ed25519.pub"

if [ -z "$GITHUB_TOKEN" ]; then
  echo "Erro: defina GITHUB_TOKEN."
  echo ""
  echo "1. Abra: https://github.com/settings/tokens/new"
  echo "2. Note: ex. 'Adicionar chave SSH'"
  echo "3. Marque o scope: admin:public_key"
  echo "4. Gere o token e rode:"
  echo "   GITHUB_TOKEN=ghp_xxxx ./scripts/add-ssh-key-to-github.sh"
  exit 1
fi

if [ ! -f "$KEY_FILE" ]; then
  echo "Erro: chave não encontrada em $KEY_FILE"
  exit 1
fi

KEY=$(cat "$KEY_FILE")
TITLE="Mac-$(hostname -s 2>/dev/null || echo 'tickrify')"
KEY_JSON=$(echo "$KEY" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read().strip()))")
PAYLOAD=$(echo "{\"title\":\"$TITLE\",\"key\":$KEY_JSON}")

echo "Adicionando chave SSH ao GitHub (título: $TITLE)..."
RESP=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  -H "Content-Type: application/json" \
  https://api.github.com/user/keys \
  -d "$PAYLOAD")

HTTP_CODE=$(echo "$RESP" | tail -n1)
BODY=$(echo "$RESP" | sed '$d')

if [ "$HTTP_CODE" = "201" ]; then
  echo "Chave adicionada com sucesso. Pode dar git push agora."
else
  echo "Erro HTTP $HTTP_CODE: $BODY"
  exit 1
fi
