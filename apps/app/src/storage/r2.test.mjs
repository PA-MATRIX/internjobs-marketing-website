// apps/app/src/storage/r2.test.mjs
//
// v1.2 STORAGE-01 — smoke unit tests for the R2 scaffold.
//
// What's covered:
//   1. getR2Client() returns null when ANY of the four envs is missing.
//   2. getR2Client() returns a non-null client when all four envs are set.
//   3. Singleton behavior — second call returns same instance (until reset).
//   4. Key helper sanitization (sanitize, studentKey, startupKey,
//      conversationKey, roleKey) — happy path + invalid filename rejection.
//
// Bucket calls (putObject, signedGetUrl) require live R2 — we don't exercise
// them here. The signature/contract is asserted via the typeof check.
//
// Runs under `node --test`. NO database, NO network — pure unit smoke.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  __resetR2ClientForTest,
  conversationKey,
  getR2Client,
  roleKey,
  sanitize,
  startupKey,
  studentKey,
} from "./r2.mjs";

const STUB_ENV = {
  R2_ACCOUNT_ID: "stub-acct-1234567890",
  R2_ACCESS_KEY_ID: "stub-key-id",
  R2_SECRET_ACCESS_KEY: "stub-secret",
  R2_BUCKET: "internjobs-agent-store-test",
};

test("getR2Client returns null when no envs set", () => {
  __resetR2ClientForTest();
  const client = getR2Client({});
  assert.equal(client, null, "no envs → null");
});

test("getR2Client returns null when accountId missing", () => {
  __resetR2ClientForTest();
  const client = getR2Client({
    R2_ACCESS_KEY_ID: "k",
    R2_SECRET_ACCESS_KEY: "s",
  });
  assert.equal(client, null, "missing accountId → null");
});

test("getR2Client returns null when accessKeyId missing", () => {
  __resetR2ClientForTest();
  const client = getR2Client({
    R2_ACCOUNT_ID: "acct",
    R2_SECRET_ACCESS_KEY: "s",
  });
  assert.equal(client, null, "missing accessKeyId → null");
});

test("getR2Client returns null when secretAccessKey missing", () => {
  __resetR2ClientForTest();
  const client = getR2Client({
    R2_ACCOUNT_ID: "acct",
    R2_ACCESS_KEY_ID: "k",
  });
  assert.equal(client, null, "missing secretAccessKey → null");
});

test("getR2Client honors CF_ACCOUNT_ID fallback", () => {
  __resetR2ClientForTest();
  const client = getR2Client({
    CF_ACCOUNT_ID: "fallback-acct",
    R2_ACCESS_KEY_ID: "k",
    R2_SECRET_ACCESS_KEY: "s",
  });
  assert.notEqual(client, null, "CF_ACCOUNT_ID should populate accountId");
  assert.equal(typeof client.putObject, "function");
  assert.equal(typeof client.signedGetUrl, "function");
  assert.equal(typeof client.bucket, "string");
});

test("getR2Client returns non-null client with all envs", () => {
  __resetR2ClientForTest();
  const client = getR2Client(STUB_ENV);
  assert.notEqual(client, null, "all envs → client");
  assert.equal(client.bucket, "internjobs-agent-store-test");
  assert.equal(typeof client.putObject, "function");
  assert.equal(typeof client.signedGetUrl, "function");
});

test("getR2Client uses default bucket when R2_BUCKET unset", () => {
  __resetR2ClientForTest();
  const client = getR2Client({
    R2_ACCOUNT_ID: "acct",
    R2_ACCESS_KEY_ID: "k",
    R2_SECRET_ACCESS_KEY: "s",
  });
  assert.equal(client.bucket, "internjobs-agent-store");
});

test("getR2Client singleton: second call returns same instance", () => {
  __resetR2ClientForTest();
  const a = getR2Client(STUB_ENV);
  const b = getR2Client(STUB_ENV);
  assert.equal(a, b, "singleton");
});

// ─── Key helper tests ────────────────────────────────────────────────────────

test("sanitize: happy path", () => {
  assert.equal(sanitize("Hello World.PNG"), "hello-world.png");
  assert.equal(sanitize("resume_v3.pdf"), "resume_v3.pdf");
  assert.equal(sanitize("  trim-me.txt  "), "trim-me.txt");
});

test("sanitize: strips path separators (keeps last segment only)", () => {
  assert.equal(sanitize("a/b/c.txt"), "c.txt");
  assert.equal(sanitize("../../etc/passwd"), "passwd");
  assert.equal(sanitize("C:\\Users\\me\\file.txt"), "file.txt");
});

test("sanitize: drops weird chars but keeps . _ -", () => {
  // Whitespace → '-' (one pass), then non-[a-z0-9._-] stripped. So
  // "file (1).pdf" → "file-(1).pdf" → "file-1.pdf".
  assert.equal(sanitize("file (1).pdf"), "file-1.pdf");
  assert.equal(sanitize("file@home#1.txt"), "filehome1.txt");
});

test("sanitize: rejects empty, dot, dotdot", () => {
  assert.throws(() => sanitize(""), /invalid filename/);
  assert.throws(() => sanitize("   "), /invalid filename/);
  assert.throws(() => sanitize("."), /invalid filename/);
  assert.throws(() => sanitize(".."), /invalid filename/);
  assert.throws(() => sanitize("///"), /invalid filename/);
});

test("studentKey: builds students/{id}/{file}", () => {
  assert.equal(studentKey("stud-1", "Resume.PDF"), "students/stud-1/resume.pdf");
  assert.throws(() => studentKey("", "x.txt"), /studentId is required/);
  assert.throws(() => studentKey("stud-1", ""), /invalid filename/);
});

test("startupKey: builds startups/{id}/{file}", () => {
  assert.equal(startupKey("start-1", "Logo.PNG"), "startups/start-1/logo.png");
  assert.throws(() => startupKey("", "x.txt"), /startupId is required/);
});

test("conversationKey: builds conversations/{id}/{file}", () => {
  assert.equal(
    conversationKey("conv-1", "transcript.txt"),
    "conversations/conv-1/transcript.txt",
  );
  assert.throws(() => conversationKey("", "x.txt"), /conversationId is required/);
});

test("roleKey: builds startups/{sid}/roles/{rid}/{file}", () => {
  assert.equal(
    roleKey("start-1", "role-1", "JD.PDF"),
    "startups/start-1/roles/role-1/jd.pdf",
  );
  assert.throws(() => roleKey("", "r", "x.txt"), /startupId is required/);
  assert.throws(() => roleKey("s", "", "x.txt"), /roleId is required/);
});
