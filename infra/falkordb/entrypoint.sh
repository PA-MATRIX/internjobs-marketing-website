#!/bin/sh
# v1.2 MEMORY-01 — FalkorDB Fly machine entrypoint.
#
# Reads $REDIS_PASSWORD from the env (Fly secret) and exec's redis-server
# with --requirepass, --loadmodule, persistence flags.
#
# We deliberately do NOT use the upstream image's run.sh wrapper because
# its `${REDIS_ARGS}` expansion path doesn't survive the Fly init secret-
# injection layer cleanly for our use case (see Dockerfile comment).

set -e

# Fail loud if the secret is missing — better than booting un-protected.
if [ -z "$REDIS_PASSWORD" ]; then
  echo "FATAL: REDIS_PASSWORD env var is empty. Set the Fly secret with:"
  echo "  flyctl secrets set REDIS_PASSWORD=<value>"
  exit 1
fi

# Ensure the data dir exists (the Fly volume mounts at /data; this is
# idempotent on subsequent boots).
mkdir -p /data

# Boot-time visibility: log the password LENGTH (not the value) so we can
# verify Fly's secret injection populated the env. The hex token we use
# is 64 chars; anything else is a red flag worth alerting on.
echo "entrypoint: REDIS_PASSWORD len=${#REDIS_PASSWORD}"

exec redis-server \
  --requirepass "$REDIS_PASSWORD" \
  --loadmodule /var/lib/falkordb/bin/falkordb.so \
  --dir /data \
  --appendonly yes \
  --protected-mode no
