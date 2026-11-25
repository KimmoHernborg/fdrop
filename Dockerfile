FROM oven/bun:1-alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1-alpine
WORKDIR /app
ARG PORT=3000
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=${PORT}
COPY --from=build /app/dist ./
RUN mkdir -p /data && chown bun:bun /data
USER bun
VOLUME /data
EXPOSE ${PORT}
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD bun -e "fetch('http://localhost:' + (process.env.PORT || 3000) + '/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["bun", "server.js"]
