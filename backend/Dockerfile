FROM golang:1.26-alpine AS build

WORKDIR /src
COPY backend/go.mod ./
RUN go mod download
COPY backend/*.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /honne-api .

FROM alpine:3.23
LABEL org.opencontainers.image.source="https://github.com/GMkonan/honne" \
    org.opencontainers.image.title="Honne backend" \
    org.opencontainers.image.description="Local-first media library API"
RUN addgroup -S honne && adduser -S -G honne honne \
    && mkdir -p /data \
    && chown honne:honne /data
COPY --from=build /honne-api /usr/local/bin/honne-api
ENV PORT=8080
USER honne
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/api/health || exit 1
ENTRYPOINT ["honne-api"]
