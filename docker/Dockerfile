# syntax=docker/dockerfile:1.7
# One build for the workspace; two runtime images:
#   --target pipeline  -> `mf` (ingest + metric refresh scheduler)
#   --target api       -> `mf-api` (read-only REST API)
FROM rust:1.99-slim-bookworm AS build
WORKDIR /app
# Build dependencies first so source edits don't recompile them.
COPY Cargo.toml Cargo.lock build.rs ./
COPY api/Cargo.toml api/Cargo.toml
RUN mkdir -p src api/src \
    && echo 'fn main() {}' > src/main.rs && touch src/lib.rs \
    && echo 'fn main() {}' > api/src/main.rs && touch api/src/lib.rs \
    && cargo build --release --locked --workspace \
    && rm -rf src api/src
COPY src src
COPY sql sql
COPY api/src api/src
RUN touch src/main.rs src/lib.rs api/src/main.rs api/src/lib.rs \
    && cargo build --release --locked --workspace

FROM debian:bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tzdata curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 mf
WORKDIR /app
USER mf

FROM runtime AS pipeline
COPY --from=build /app/target/release/mf /usr/local/bin/mf
COPY config /app/config
ENV MF_CONFIG_DIR=/app/config
ENTRYPOINT ["mf"]
CMD ["run"]

FROM runtime AS api
COPY --from=build /app/target/release/mf-api /usr/local/bin/mf-api
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:8080/health || exit 1
ENTRYPOINT ["mf-api"]
