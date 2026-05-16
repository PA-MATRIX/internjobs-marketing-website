-- migration: 0005_v1_2_workers_ai_embeddings
-- description: v1.2 (post-launch 2026-05-16) — swap the v1.2 LLM/embedding
--              path from OpenAI to Cloudflare Workers AI (via the internal
--              proxy Worker `internjobs-ai-proxy`).
--
-- Why:
--   We moved both embeddings and chat completion off OpenAI onto Cloudflare
--   Workers AI native bindings. The new embedding model is BGE-base
--   (`@cf/baai/bge-base-en-v1.5`) which produces 768-dim vectors instead of
--   OpenAI text-embedding-3-small's 1536-dim. Tables `student_embeddings`
--   and `role_embeddings` are EMPTY at the time this migration runs
--   (verified pre-deploy via `select count(*) from ...`), so swapping the
--   column type and rebuilding the HNSW index in one shot is safe.
--
-- Embedding model lock (PITFALLS #18 — supersedes the 0004 lock):
--   model:      @cf/baai/bge-base-en-v1.5
--   dimension:  768
--   distance:   cosine (vector_cosine_ops)
--   index:      HNSW, m=16, ef_construction=64
--   Changing any of these requires a full re-embed + index rebuild. Do
--   NOT bump in-place.
--
-- DDL ordering: drop the HNSW indexes FIRST (they reference the column),
-- then drop the column, add it back at vector(768), reset the model
-- default, then rebuild the indexes. All inside the migrate.mjs BEGIN/
-- COMMIT, which is safe at v1.2 data volume.

-- Existing HNSW indexes use the *_hnsw_idx suffix from migration 0004. The
-- *_vec_idx names are kept here only for forward-compat in case a future
-- branch ever renamed them; `if exists` makes both drops safe.
drop index if exists student_embeddings_hnsw_idx;
drop index if exists role_embeddings_hnsw_idx;
drop index if exists student_embeddings_vec_idx;
drop index if exists role_embeddings_vec_idx;

alter table student_embeddings drop column embedding;
alter table student_embeddings add column embedding vector(768);
alter table student_embeddings alter column model set default '@cf/baai/bge-base-en-v1.5';
-- Defensive: any pre-existing rows (none expected on the empty table) get
-- their model identifier flipped so downstream queries by model don't
-- silently mis-attribute.
update student_embeddings set model = '@cf/baai/bge-base-en-v1.5' where model = 'text-embedding-3-small';

alter table role_embeddings drop column embedding;
alter table role_embeddings add column embedding vector(768);
alter table role_embeddings alter column model set default '@cf/baai/bge-base-en-v1.5';
update role_embeddings set model = '@cf/baai/bge-base-en-v1.5' where model = 'text-embedding-3-small';

-- Recreate with the same *_hnsw_idx names as migration 0004 for continuity.
create index student_embeddings_hnsw_idx
  on student_embeddings using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

create index role_embeddings_hnsw_idx
  on role_embeddings using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);
