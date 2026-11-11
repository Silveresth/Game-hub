# Steal a Masterpiece — image de production (site + API + temps réel sur un seul port).
# Construction : docker build -t steal-a-masterpiece .
# Les données (joueurs, ventes, clés push) vivent dans le volume /app/server/data.

FROM node:22.12.0-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22.12.0-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY src/shared ./src/shared
COPY deploy/entrypoint.sh /entrypoint.sh
# su-exec : le conteneur démarre en root pour s'approprier le disque monté (Render, Docker…), puis passe à l'utilisateur node
RUN apk add --no-cache su-exec && chmod +x /entrypoint.sh && rm -rf server/data && mkdir -p server/data && chown -R node:node server/data
VOLUME /app/server/data
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- "http://127.0.0.1:${PORT:-3001}/api/stats" > /dev/null || exit 1
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "server/index.mjs"]
