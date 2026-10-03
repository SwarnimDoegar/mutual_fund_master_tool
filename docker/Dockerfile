# syntax=docker/dockerfile:1.7
FROM rust:1.99-slim-bookworm AS build
WORKDIR /app
# Build dependencies first so source edits don't recompile them.
COPY Cargo.toml Cargo.lock build.rs ./
RUN mkdir src && echo 'fn main() {}' > src/main.rs \
    && cargo build --release --locked \
    && rm -rf src
COPY src src
COPY sql sql
RUN touch src/main.rs && cargo build --release --locked

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tzdata \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 mf
COPY --from=build /app/target/release/mf /usr/local/bin/mf
COPY config /app/config
WORKDIR /app
USER mf
ENV MF_CONFIG_DIR=/app/config
ENTRYPOINT ["mf"]
CMD ["run"]
