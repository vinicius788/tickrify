#!/bin/bash

# Script para parar toda a stack do Tickrify
# Uso: ./PARAR_TUDO.sh

echo "🛑 Parando Tickrify Stack..."
echo ""

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Tentar ler PIDs salvos
if [ -f ".pids" ]; then
    source .pids
    
    if [ ! -z "$BACKEND_PID" ]; then
        echo -e "${YELLOW}Parando Backend (PID: $BACKEND_PID)...${NC}"
        kill $BACKEND_PID 2>/dev/null && echo -e "${GREEN}✅ Backend parado${NC}" || echo -e "${RED}⚠️  Backend já estava parado${NC}"
    fi
    
    if [ ! -z "$WORKER_PID" ]; then
        echo -e "${YELLOW}Parando Worker (PID: $WORKER_PID)...${NC}"
        kill $WORKER_PID 2>/dev/null && echo -e "${GREEN}✅ Worker parado${NC}" || echo -e "${RED}⚠️  Worker já estava parado${NC}"
    fi
    
    if [ ! -z "$FRONTEND_PID" ]; then
        echo -e "${YELLOW}Parando Frontend (PID: $FRONTEND_PID)...${NC}"
        kill $FRONTEND_PID 2>/dev/null && echo -e "${GREEN}✅ Frontend parado${NC}" || echo -e "${RED}⚠️  Frontend já estava parado${NC}"
    fi
    
    rm .pids
else
    echo -e "${YELLOW}Arquivo .pids não encontrado. Tentando parar pelos nomes dos processos...${NC}"
fi

# Parar processos pelas portas (fallback)
echo ""
echo -e "${YELLOW}Verificando portas...${NC}"

if lsof -ti:3001 >/dev/null 2>&1; then
    echo -e "${YELLOW}Matando processo na porta 3001 (Backend)...${NC}"
    lsof -ti:3001 | xargs kill -9
    echo -e "${GREEN}✅ Porta 3001 liberada${NC}"
fi

if lsof -ti:5173 >/dev/null 2>&1; then
    echo -e "${YELLOW}Matando processo na porta 5173 (Frontend)...${NC}"
    lsof -ti:5173 | xargs kill -9
    echo -e "${GREEN}✅ Porta 5173 liberada${NC}"
fi

# Parar processos Node relacionados ao projeto (cuidado!)
echo ""
echo -e "${YELLOW}Limpando processos Node relacionados ao Tickrify...${NC}"
pkill -f "nest start" 2>/dev/null
pkill -f "vite" 2>/dev/null
pkill -f "worker.ts" 2>/dev/null

echo ""
echo -e "${GREEN}═══════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ TICKRIFY STACK PARADA${NC}"
echo -e "${GREEN}═══════════════════════════════════════════${NC}"
echo ""
