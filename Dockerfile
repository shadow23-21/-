FROM node:24-bookworm-slim AS webbuild
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
ARG VITE_API_BASE=""
ENV VITE_API_BASE=${VITE_API_BASE}
ENV VITE_DIRECT_DEEPSEEK=false
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8787
ENV BILLING_DB=/data/billing.db
COPY package.json ./
COPY server ./server
COPY src ./src
COPY scripts ./scripts
COPY --from=webbuild /app/web/dist ./web/dist
RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 8787
CMD ["node", "server/gateway.mjs"]
