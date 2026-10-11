FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY scripts ./scripts
USER node
EXPOSE 8080
CMD ["node", "scripts/start.mjs"]
