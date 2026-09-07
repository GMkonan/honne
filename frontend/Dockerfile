FROM denoland/deno:2.9.4 AS build

WORKDIR /app
COPY frontend/deno.json frontend/deno.lock frontend/package.json ./
RUN deno install --frozen
COPY frontend/index.html frontend/tsconfig.json frontend/vite.config.ts ./
COPY frontend/public ./public
COPY frontend/src ./src
RUN deno task build

FROM nginx:1.29-alpine
LABEL org.opencontainers.image.source="https://github.com/GMkonan/honne" \
    org.opencontainers.image.title="Honne frontend" \
    org.opencontainers.image.description="Web interface for the Honne media library"
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
    CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
