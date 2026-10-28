FROM node:22.23.4-slim
RUN test "$(node --version)" = "v22.23.4"
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY scripts ./scripts
USER node
EXPOSE 8080
CMD ["node", "scripts/start.mjs"]
