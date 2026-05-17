// apps/app/src/workflows/reply-to.test.mjs
//
// v1.2 EMAIL-03 — unit tests for per-conversation Reply-To alias helpers.
// Subdomain isolation update 2026-05-16: aliases live on
// `agent.internjobs.ai`, NOT the apex `internjobs.ai`.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildConversationReplyTo,
  parseConversationReplyTo,
  validateConversationUuid,
} from "./reply-to.mjs";

const UUID = "abcdef12-3456-7890-abcd-ef1234567890";

test("buildConversationReplyTo: happy path (subdomain)", () => {
  assert.equal(
    buildConversationReplyTo(UUID),
    `conv-${UUID}@agent.internjobs.ai`,
  );
});

test("buildConversationReplyTo: lowercases", () => {
  assert.equal(
    buildConversationReplyTo(UUID.toUpperCase()),
    `conv-${UUID}@agent.internjobs.ai`,
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

test("parseConversationReplyTo: plain address (subdomain)", () => {
  assert.equal(
    parseConversationReplyTo(`conv-${UUID}@agent.internjobs.ai`),
    UUID,
  );
});

test("parseConversationReplyTo: angle-bracketed (subdomain)", () => {
  assert.equal(
    parseConversationReplyTo(`"Op Person" <conv-${UUID}@agent.internjobs.ai>`),
    UUID,
  );
});

test("parseConversationReplyTo: case-insensitive prefix + domain", () => {
  assert.equal(
    parseConversationReplyTo(`CONV-${UUID.toUpperCase()}@AGENT.INTERNJOBS.AI`),
    UUID,
  );
});

test("parseConversationReplyTo: apex addresses are NOT parsed as conv aliases", () => {
  // The apex `internjobs.ai` is reserved for human email. A reply that
  // strips the `agent.` subdomain (e.g. founder retypes the address) must
  // NOT be treated as a conv alias — it goes to the human fallback inbox
  // via CF Email Routing apex rule, not to the Worker.
  assert.equal(
    parseConversationReplyTo(`conv-${UUID}@internjobs.ai`),
    null,
    "apex `conv-<uuid>@internjobs.ai` must not parse as a conv alias",
  );
  assert.equal(
    parseConversationReplyTo(`"Founder" <conv-${UUID}@internjobs.ai>`),
    null,
    "apex `conv-<uuid>@internjobs.ai` (angle-bracketed) must not parse as a conv alias",
  );
});

test("parseConversationReplyTo: non-conv addresses → null", () => {
  assert.equal(parseConversationReplyTo("ops@internjobs.ai"), null);
  assert.equal(parseConversationReplyTo("raj@internjobs.ai"), null);
  assert.equal(parseConversationReplyTo("someone@agent.internjobs.ai"), null);
  assert.equal(parseConversationReplyTo("conv-12345@agent.internjobs.ai"), null);
  assert.equal(parseConversationReplyTo(`conv-${UUID}@example.com`), null);
  assert.equal(parseConversationReplyTo(`conv-${UUID}@agent.example.com`), null);
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
