#!/bin/bash

# Script para iniciar toda a stack do Tickrify
# Uso: ./INICIAR_TUDO.sh

echo "🚀 Iniciando Tickrify Stack..."
echo ""

# Cores para output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Verificar se estamos no diretório correto
if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ Execute este script na raiz do projeto!${NC}"
    exit 1
fi

# Função para verificar se uma porta está em uso
check_port() {
    local port=$1
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
        return 0  # Porta em uso
    else
        return 1  # Porta livre
    fi
}

# Verificar Redis
echo -e "${BLUE}🔍 Verificando Redis...${NC}"
if redis-cli ping &> /dev/null; then
    echo -e "${GREEN}✅ Redis já está rodando${NC}"
else
    echo -e "${YELLOW}⚠️  Redis não está rodando. Tentando iniciar...${NC}"
    if command -v redis-server &> /dev/null; then
        redis-server --daemonize yes
        sleep 2
        if redis-cli ping &> /dev/null; then
            echo -e "${GREEN}✅ Redis iniciado com sucesso!${NC}"
        else
            echo -e "${RED}❌ Falha ao iniciar Redis. Inicie manualmente: redis-server --daemonize yes${NC}"
            exit 1
        fi
    else
        echo -e "${RED}❌ Redis não está instalado. Instale com: brew install redis${NC}"
        exit 1
    fi
fi

echo ""
echo -e "${BLUE}📦 Verificando dependências...${NC}"

# Verificar e instalar dependências do backend
if [ ! -d "apps/backend/node_modules" ]; then
    echo -e "${YELLOW}⚠️  Instalando dependências do backend...${NC}"
    cd apps/backend && npm install && cd ../..
fi

# Verificar e instalar dependências do frontend
if [ ! -d "apps/frontend/node_modules" ]; then
    echo -e "${YELLOW}⚠️  Instalando dependências do frontend...${NC}"
    cd apps/frontend && npm install && cd ../..
fi

echo -e "${GREEN}✅ Dependências verificadas${NC}"
echo ""

# Verificar se as portas estão disponíveis
echo -e "${BLUE}🔍 Verificando portas...${NC}"

if check_port 3001; then
    echo -e "${YELLOW}⚠️  Porta 3001 (Backend) já está em uso${NC}"
    read -p "Deseja matar o processo? (s/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Ss]$ ]]; then
        lsof -ti:3001 | xargs kill -9
        echo -e "${GREEN}✅ Processo na porta 3001 finalizado${NC}"
    fi
fi

if check_port 5173; then
    echo -e "${YELLOW}⚠️  Porta 5173 (Frontend) já está em uso${NC}"
    read -p "Deseja matar o processo? (s/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Ss]$ ]]; then
        lsof -ti:5173 | xargs kill -9
        echo -e "${GREEN}✅ Processo na porta 5173 finalizado${NC}"
    fi
fi

echo ""
echo -e "${GREEN}🚀 Iniciando serviços...${NC}"
echo ""

# Criar diretório para logs
mkdir -p logs

# Iniciar Backend
echo -e "${BLUE}1️⃣  Iniciando Backend (NestJS) na porta 3001...${NC}"
cd apps/backend
npm run dev > ../../logs/backend.log 2>&1 &
BACKEND_PID=$!
cd ../..
echo -e "${YELLOW}   Aguardando backend iniciar (isso pode levar 10-15 segundos)...${NC}"
sleep 15

# Verificar se o backend iniciou
if check_port 3001; then
    echo -e "${GREEN}✅ Backend rodando em http://localhost:3001${NC}"
else
    echo -e "${RED}❌ Falha ao iniciar backend. Verifique logs/backend.log${NC}"
    cat logs/backend.log | tail -20
    kill $BACKEND_PID 2>/dev/null
    exit 1
fi

# Iniciar Worker
echo -e "${BLUE}2️⃣  Iniciando Worker (BullMQ)...${NC}"
cd apps/backend
npm run worker > ../../logs/worker.log 2>&1 &
WORKER_PID=$!
cd ../..
sleep 2
echo -e "${GREEN}✅ Worker iniciado${NC}"

# Iniciar Frontend
echo -e "${BLUE}3️⃣  Iniciando Frontend (Vite) na porta 5173...${NC}"
cd apps/frontend
npm run dev > ../../logs/frontend.log 2>&1 &
FRONTEND_PID=$!
cd ../..
sleep 5

# Verificar se o frontend iniciou
if check_port 5173; then
    echo -e "${GREEN}✅ Frontend rodando em http://localhost:5173${NC}"
else
    echo -e "${RED}❌ Falha ao iniciar frontend. Verifique logs/frontend.log${NC}"
    cat logs/frontend.log | tail -20
    kill $BACKEND_PID $WORKER_PID $FRONTEND_PID 2>/dev/null
    exit 1
fi

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ TICKRIFY STACK INICIADA COM SUCESSO!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
echo ""
echo -e "${BLUE}📍 URLs:${NC}"
echo -e "   🌐 Frontend:  ${GREEN}http://localhost:5173${NC}"
echo -e "   ⚙️  Backend:   ${GREEN}http://localhost:3001${NC}"
echo -e "   🔴 Redis:     ${GREEN}localhost:6379${NC}"
echo ""
echo -e "${BLUE}📊 Status dos Processos:${NC}"
echo -e "   Backend PID:  ${YELLOW}$BACKEND_PID${NC}"
echo -e "   Worker PID:   ${YELLOW}$WORKER_PID${NC}"
echo -e "   Frontend PID: ${YELLOW}$FRONTEND_PID${NC}"
echo ""
echo -e "${BLUE}📝 Logs:${NC}"
echo -e "   Backend:  logs/backend.log"
echo -e "   Worker:   logs/worker.log"
echo -e "   Frontend: logs/frontend.log"
echo ""
echo -e "${YELLOW}💡 Dica: Use ${GREEN}./PARAR_TUDO.sh${YELLOW} para parar todos os serviços${NC}"
echo ""
echo -e "${GREEN}🎉 Pronto para usar! Acesse: http://localhost:5173${NC}"
echo ""

# Salvar PIDs para script de parada
cat > .pids <<EOF
BACKEND_PID=$BACKEND_PID
WORKER_PID=$WORKER_PID
FRONTEND_PID=$FRONTEND_PID
EOF

# Seguir os logs (opcional)
echo -e "${YELLOW}Pressione Ctrl+C para parar de seguir os logs (os serviços continuarão rodando)${NC}"
echo ""
sleep 2
tail -f logs/frontend.log
