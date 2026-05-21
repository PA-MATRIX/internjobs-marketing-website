# Self-hosted Postgres 17 for Mattermost — see fly.toml for rationale.
#
# Pinned to postgres:17 to match the Neon source (PG17) and stay on
# Mattermost 11.6's supported Postgres matrix. Bump deliberately.
#
# listen_addresses=* so Postgres accepts connections over Fly's 6PN
# IPv6 private network (the stock image config is localhost-only).
FROM postgres:17

CMD ["postgres", "-c", "listen_addresses=*"]
