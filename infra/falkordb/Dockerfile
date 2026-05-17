# Custom FalkorDB image for v1.2 MEMORY-01.
#
# Why we don't use the upstream `falkordb/falkordb:latest` directly:
# the upstream image's entrypoint script `/var/lib/falkordb/bin/run.sh`
# does `exec redis-server ${REDIS_ARGS} ...`. With REDIS_ARGS set as a
# Fly env or secret, the resulting tokens are passed to redis-server
# WITHOUT a second shell expansion pass — so an embedded `$REDIS_PASSWORD`
# in the args lands as a literal string. And on Fly machines, the env
# var interpolation behavior between /fly/init's secret-injection layer
# and the official image's entrypoint isn't predictable enough to rely on.
#
# Fix: replace the entrypoint with our own one-line wrapper that does a
# fresh `${REDIS_PASSWORD}` expansion at exec time, after Fly's init has
# fully populated the environment. The password thus never appears in any
# config file, build layer, or fly.toml — it only lives in the Fly secret
# `REDIS_PASSWORD` and gets expanded into argv at process start.

FROM falkordb/falkordb:latest

# Replace the entrypoint with our wrapper. Quoting `$REDIS_PASSWORD` in
# double quotes ensures any unusual char in the secret value (we use a
# hex token so this is belt-and-suspenders) is treated as one argv slot.
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
