// Bucket is PRIVATE. All sharing uses signedGetUrl with TTL. Matches Mala policy.
//
// apps/app/src/storage/r2.mjs
//
// v1.2 STORAGE-01 (scope-add 2026-05-16) — R2 storage scaffold for the
// agent's per-entity artifact tree. Ported (and trimmed) from the
// SuperIntelligence `r2-uploads-client.ts` pattern. v1.2 ships only the
// storage layer — no ingestion is wired yet (deferred to v1.3 STORAGE-02
// for email + MMS attachment ingest, and STORAGE-03 for permanent short
// links via mapping bucket + redirector Worker).
//
// Per-entity folder convention (single bucket, row-level partition):
//   students/{student_id}/{file}
//   startups/{startup_id}/{file}
//   conversations/{conversation_id}/{file}
//   startups/{startup_id}/roles/{role_id}/{file}
//
// Why one bucket and not one per entity: per-user Postgres schemas are
// heavyweight for InternJobs's volume. Row-level partitioning via the
// student_id/startup_id prefix is sufficient for v1.2 and matches how
// the rest of the v1.2 schema treats authorization (Postgres FKs +
// middleware checks).
//
// Env (read once at module construction; all four required):
//   R2_ACCOUNT_ID            (or CF_ACCOUNT_ID as fallback)
//   R2_ACCESS_KEY_ID
//   R2_SECRET_ACCESS_KEY
//   R2_BUCKET                (default `internjobs-agent-store`)
//
// When any of these is unset, `getR2Client()` returns null. Callers MUST
// check for null and fail-soft — never throw on missing R2 envs. The
// `/healthz` endpoint surfaces `r2Ready` (true iff all four envs + a
// non-null client) so the operator can see the state without crashing
// the app.

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const DEFAULT_BUCKET = "internjobs-agent-store";
const DEFAULT_TTL_SECONDS = 3600; // 1 hour
const MAX_TTL_SECONDS = 7 * 24 * 3600; // AWS sig v4 hard cap (7 days)

let SINGLETON; // undefined = not constructed; null = constructed-but-unset-env

/**
 * Singleton R2 client. Returns null when any of the four required envs is
 * unset; callers MUST fail-soft on null.
 *
 * @param {NodeJS.ProcessEnv} [env]  Override the env source (test seam).
 * @returns {R2Client | null}
 */
export function getR2Client(env = process.env) {
  if (SINGLETON !== undefined) return SINGLETON;
  SINGLETON = buildR2Client(env);
  return SINGLETON;
}

/** Test seam — reset singleton between unit tests. */
export function __resetR2ClientForTest() {
  SINGLETON = undefined;
}

function buildR2Client(env) {
  const accountId = env.R2_ACCOUNT_ID || env.CF_ACCOUNT_ID || "";
  const accessKeyId = env.R2_ACCESS_KEY_ID || "";
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY || "";
  const bucket = env.R2_BUCKET || DEFAULT_BUCKET;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    return null;
  }

  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  const s3 = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });

  return {
    get bucket() {
      return bucket;
    },
    async putObject({ key, body, contentType }) {
      if (!key) throw new Error("r2.putObject: key is required");
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ...(contentType ? { ContentType: contentType } : {}),
        }),
      );
      return { bucket, key };
    },
    async signedGetUrl({ key, expiresInSeconds } = {}) {
      if (!key) throw new Error("r2.signedGetUrl: key is required");
      let ttl = Number.isFinite(expiresInSeconds)
        ? Math.floor(expiresInSeconds)
        : DEFAULT_TTL_SECONDS;
      if (ttl <= 0) ttl = DEFAULT_TTL_SECONDS;
      if (ttl > MAX_TTL_SECONDS) ttl = MAX_TTL_SECONDS;
      return getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket: bucket, Key: key }),
        { expiresIn: ttl },
      );
    },
  };
}

// ─── Key helper functions (pure path builders) ──────────────────────────────
//
// These are exported as standalone functions, not methods on the client, so
// callers can build keys without booting the AWS SDK (e.g. for logging,
// dry-run paths, or future migrations to a different storage backend).

/**
 * Sanitize a user-supplied filename for use as the last segment of an R2
 * key. Strips path separators, lowercases, collapses whitespace to `-`, and
 * keeps only `[a-z0-9._-]`. Throws on `.`, `..`, or empty results.
 */
export function sanitize(name) {
  const raw = String(name || "").trim();
  if (!raw) throw new Error("invalid filename");
  // Drop any directory components — keep only the last segment.
  const lastSeg = raw.split(/[\\/]/g).filter(Boolean).pop() || "";
  const lowered = lastSeg.toLowerCase().replace(/\s+/g, "-");
  // Keep alphanum, dot, underscore, hyphen. Drop everything else.
  const cleaned = lowered.replace(/[^a-z0-9._-]/g, "");
  if (!cleaned || cleaned === "." || cleaned === "..") {
    throw new Error("invalid filename");
  }
  return cleaned;
}

export function studentKey(studentId, filename) {
  if (!studentId) throw new Error("studentKey: studentId is required");
  return `students/${studentId}/${sanitize(filename)}`;
}

export function startupKey(startupId, filename) {
  if (!startupId) throw new Error("startupKey: startupId is required");
  return `startups/${startupId}/${sanitize(filename)}`;
}

export function conversationKey(conversationId, filename) {
  if (!conversationId) throw new Error("conversationKey: conversationId is required");
  return `conversations/${conversationId}/${sanitize(filename)}`;
}

export function roleKey(startupId, roleId, filename) {
  if (!startupId) throw new Error("roleKey: startupId is required");
  if (!roleId) throw new Error("roleKey: roleId is required");
  return `startups/${startupId}/roles/${roleId}/${sanitize(filename)}`;
}

// ─── Type stub (JSDoc) ──────────────────────────────────────────────────────
/**
 * @typedef {object} R2Client
 * @property {string} bucket
 * @property {(args: { key: string, body: Uint8Array | Buffer | string, contentType?: string }) => Promise<{ bucket: string, key: string }>} putObject
 * @property {(args: { key: string, expiresInSeconds?: number }) => Promise<string>} signedGetUrl
 */
