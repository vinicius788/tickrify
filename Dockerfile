# Usar Node.js 20
FROM node:20-bookworm-slim

# OpenSSL para Prisma (evita warnings e problemas de runtime)
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

# Definir diretório de trabalho
WORKDIR /app

# Copiar package files da raiz (monorepo)
COPY package*.json ./
COPY apps/backend/package*.json ./apps/backend/

# Copiar apenas o schema do Prisma antes do install (postinstall do @prisma/client precisa do schema)
RUN mkdir -p ./apps/backend/prisma
COPY apps/backend/prisma ./apps/backend/prisma

# Instalar dependências (workspace)
RUN npm install

# Copiar código fonte completo
COPY . .

# Build do backend
WORKDIR /app/apps/backend
RUN npm run build

# Gerar Prisma Client
RUN npx prisma generate --schema=./prisma/schema.prisma

# Copiar entrypoint que roda migrations e inicia o servidor
WORKDIR /app
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Expor porta do backend
EXPOSE 3001

# EntryPoint garante execução do script mesmo se a plataforma definir um Start Command
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
# Comando padrão (usado como args do entrypoint se Start Command for definido)
CMD ["npm", "run", "start:prod"]
