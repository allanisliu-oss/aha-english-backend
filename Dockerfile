FROM node:20-alpine

WORKDIR /app

# 先拷 package 文件，借用 docker 层缓存
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Prisma 需要 OpenSSL
RUN apk add --no-cache openssl

# 拷源码 + schema
COPY prisma ./prisma
COPY src ./src
COPY scripts ./scripts

# 生成 Prisma Client
RUN npx prisma generate

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["sh", "-c", "node scripts/prestart-migrate.js && node src/index.js"]
