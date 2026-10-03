#!/usr/bin/env bash
# Run cargo inside the Rust image (no local toolchain needed), with caches in Docker volumes.
#   ./dev.sh check | ./dev.sh test | ./dev.sh run -- <mf args>
set -euo pipefail
cd "$(dirname "$0")"
exec docker run --rm -i \
  --network mf_default \
  -e MF_CLICKHOUSE_URL="${MF_CLICKHOUSE_URL:-http://clickhouse:8123}" \
  -e MF_CLICKHOUSE_DATABASE="${MF_CLICKHOUSE_DATABASE:-mf}" \
  -e MF_REDIS_URL="${MF_REDIS_URL:-redis://redis:6379/15}" \
  -e RUST_LOG="${RUST_LOG:-info}" \
  -v "$PWD":/app -w /app \
  -v mf-cargo-registry:/usr/local/cargo/registry \
  -v mf-cargo-target:/app/target \
  rust:1.99-slim-bookworm cargo "$@"
