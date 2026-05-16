// apps/app/src/workflows/reply-to.test.mjs
//
// v1.2 EMAIL-03 — unit tests for per-conversation Reply-To alias helpers.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildConversationReplyTo,
  parseConversationReplyTo,
  validateConversationUuid,
} from "./reply-to.mjs";

const UUID = "abcdef12-3456-7890-abcd-ef1234567890";

test("buildConversationReplyTo: happy path", () => {
  assert.equal(buildConversationReplyTo(UUID), `conv-${UUID}@internjobs.ai`);
});

test("buildConversationReplyTo: lowercases", () => {
  assert.equal(
    buildConversationReplyTo(UUID.toUpperCase()),
    `conv-${UUID}@internjobs.ai`,
  );
});

test("buildConversationReplyTo: rejects malformed", () => {
  assert.equal(buildConversationReplyTo(""), null);
  assert.equal(buildConversationReplyTo(null), null);
  assert.equal(buildConversationReplyTo(undefined), null);
  assert.equal(buildConversationReplyTo("not-a-uuid"), null);
  assert.equal(buildConversationReplyTo("12345678"), null);
  assert.equal(buildConversationReplyTo({}), null);
});

test("parseConversationReplyTo: plain address", () => {
  assert.equal(
    parseConversationReplyTo(`conv-${UUID}@internjobs.ai`),
    UUID,
  );
});

test("parseConversationReplyTo: angle-bracketed", () => {
  assert.equal(
    parseConversationReplyTo(`"Op Person" <conv-${UUID}@internjobs.ai>`),
    UUID,
  );
});

test("parseConversationReplyTo: case-insensitive prefix", () => {
  assert.equal(
    parseConversationReplyTo(`CONV-${UUID.toUpperCase()}@INTERNJOBS.AI`),
    UUID,
  );
});

test("parseConversationReplyTo: non-conv addresses → null", () => {
  assert.equal(parseConversationReplyTo("ops@internjobs.ai"), null);
  assert.equal(parseConversationReplyTo("conv-12345@internjobs.ai"), null);
  assert.equal(parseConversationReplyTo(`conv-${UUID}@example.com`), null);
  assert.equal(parseConversationReplyTo(""), null);
  assert.equal(parseConversationReplyTo(null), null);
});

test("validateConversationUuid: happy path", () => {
  assert.equal(validateConversationUuid(UUID), UUID);
  assert.equal(validateConversationUuid(UUID.toUpperCase()), UUID);
  assert.equal(validateConversationUuid(`  ${UUID}  `), UUID);
});

test("validateConversationUuid: rejects malformed", () => {
  assert.equal(validateConversationUuid(""), null);
  assert.equal(validateConversationUuid(null), null);
  assert.equal(validateConversationUuid("not-a-uuid"), null);
  assert.equal(validateConversationUuid("12345678-1234-1234-1234"), null);
  assert.equal(validateConversationUuid(123), null);
});
