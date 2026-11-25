# Multi-stage Dockerfile zoptymalizowany pod szybkie rebuildy i maly obraz na Mikrus 3.5.
FROM rust:1-bookworm AS builder

WORKDIR /app

# Najpierw same manifesty, aby cache warstw zachowal skompilowane zaleznosci.
COPY Cargo.toml Cargo.lock* ./
COPY config ./config
RUN mkdir -p src && echo 'fn main() {}' > src/main.rs
RUN cargo build --release && rm -rf src

# Wlasciwa kompilacja binarki produkcyjnej.
COPY src ./src
RUN touch src/main.rs && cargo build --release

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl tzdata \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --create-home --shell /usr/sbin/nologin kilometr \
    && mkdir -p /data \
    && chown -R kilometr:kilometr /data

ENV TZ=Europe/Warsaw \
    KILOMETR_HOST=0.0.0.0 \
    KILOMETR_PORT=8080 \
    KILOMETR_DB_PATH=/data/kilometr-delays.db \
    RUST_LOG=kilometr_api=info,tower_http=warn

COPY --from=builder /app/target/release/kilometr-api /usr/local/bin/kilometr-api

USER kilometr
WORKDIR /data
VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=20s --timeout=4s --start-period=15s --retries=3 \
    CMD curl -fsS http://127.0.0.1:${KILOMETR_PORT:-8080}/health || exit 1

ENTRYPOINT ["/usr/local/bin/kilometr-api"]
