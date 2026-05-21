# Self-hosted Postgres 17 + pgvector for the student app — see fly.toml.
#
# pgvector/pgvector:pg17 is the official pgvector image built on the
# official postgres:17. The student DB uses the `vector` extension
# (student_embeddings / role_embeddings, HNSW indexes) — a plain
# postgres:17 image would fail the restore on `CREATE EXTENSION vector`.
#
# listen_addresses=* so Postgres accepts connections over Fly's 6PN
# IPv6 private network (the stock image config is localhost-only).
FROM pgvector/pgvector:pg17

CMD ["postgres", "-c", "listen_addresses=*"]
