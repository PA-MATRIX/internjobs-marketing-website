import { randomUUID, createHash, randomBytes } from "node:crypto";
import pg from "pg";
import { writeStudentEmbedding, logEmbedErr } from "./embeddings.mjs";

const { Pool } = pg;

export function createStore(config) {
  if (config.databaseUrl) return new PostgresStore(config.databaseUrl);
  return new MemoryStore();
}

export function createPairingCode() {
  return randomBytes(4).toString("hex").toUpperCase();
}

export function eventIdFromPayload(payload) {
  return (
    payload.id ||
    payload.messageId ||
    payload.message_id ||
    payload.eventId ||
    payload.event_id ||
    createHash("sha256").update(JSON.stringify(payload)).digest("hex")
  );
}

class MemoryStore {
  constructor() {
    this.students = new Map();
    this.pairingCodes = new Map();
    this.messagingEvents = new Set();
    this.profileContexts = new Map();
    this.profileEnrichmentJobs = new Map();
    this.studentThreads = new Map();
    this.auditEvents = [];
    this.profileSnapshots = [];
    this.consents = [];
    // v1.2 Phase 05 (operator approval gate). MemoryStore mirrors the
    // PostgresStore surface for /ops/* routes so the smoke suite can
    // exercise the approval flow without a Postgres dependency.
    this.drafts = new Map();          // id -> draft row
    this.draftFeedback = [];          // chronological log
    this.conversations = new Map();   // id -> conversation row
    this.startups = new Map();        // id -> startup row
    this.roles = new Map();           // id -> role row
    // v1.2 EMAIL-03 (scope-add 2026-05-16): in-memory mirror of
    // inbound_messages rows. Used by the per-conv alias smoke test to
    // assert that metadata.conversation_id is preserved end-to-end
    // without standing up Postgres.
    this.inboundMessages = [];        // chronological log
  }

  async upsertStudentFromAuth(auth) {
    const existing = this.students.get(auth.clerkUserId);
    const now = new Date().toISOString();
    const student = {
      id: existing?.id || randomUUID(),
      clerkUserId: auth.clerkUserId,
      email: auth.email || existing?.email || "",
      name: auth.name || existing?.name || "",
      linkedinProfileUrl: auth.linkedinProfileUrl || existing?.linkedinProfileUrl || "",
      status: existing?.status || "linkedin_connected",
      channelType: existing?.channelType || "",
      channelAddress: existing?.channelAddress || "",
      channelConfirmedAt: existing?.channelConfirmedAt || "",
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    this.students.set(auth.clerkUserId, student);
    await this.storeProfileSnapshot(student.id, auth);
    await this.queueProfileEnrichment(student.id, auth);
    await this.writeConsent(student.id, "linkedin_oauth_profile", true, auth.source);
    await this.writeAuditEvent(student.id, "student_upserted", "system", { source: auth.source });
    return student;
  }

  async getStudentByClerkId(clerkUserId) {
    return this.students.get(clerkUserId) || null;
  }

  async createOrRefreshPairingCode(studentId) {
    const now = Date.now();
    const active = [...this.pairingCodes.values()].find((item) => item.studentId === studentId && item.status === "active" && Date.parse(item.expiresAt) > now);
    if (active) return active;

    const pairing = {
      id: randomUUID(),
      studentId,
      code: createPairingCode(),
      status: "active",
      expiresAt: new Date(now + 15 * 60 * 1000).toISOString(),
      createdAt: new Date(now).toISOString(),
      confirmedAt: "",
    };
    this.pairingCodes.set(pairing.code, pairing);
    await this.writeAuditEvent(studentId, "pairing_code_created", "system", { expiresAt: pairing.expiresAt });
    return pairing;
  }

  async expireAndCreatePairingCode(studentId) {
    for (const pairing of this.pairingCodes.values()) {
      if (pairing.studentId === studentId && pairing.status === "active") pairing.status = "expired";
    }
    return this.createOrRefreshPairingCode(studentId);
  }

  async confirmPairingCode({ code, providerEventId, channelType, channelAddress, metadata }) {
    if (this.messagingEvents.has(providerEventId)) {
      return { duplicate: true, student: null, welcomeNeeded: false };
    }
    this.messagingEvents.add(providerEventId);

    const pairing = this.pairingCodes.get(code);
    if (!pairing || pairing.status !== "active" || Date.parse(pairing.expiresAt) < Date.now()) {
      return { duplicate: false, student: null, welcomeNeeded: false, error: "pairing_code_invalid" };
    }

    pairing.status = "confirmed";
    pairing.confirmedAt = new Date().toISOString();
    const student = [...this.students.values()].find((item) => item.id === pairing.studentId);
    if (!student) return { duplicate: false, student: null, welcomeNeeded: false, error: "student_not_found" };

    student.status = "channel_confirmed";
    student.channelType = channelType;
    student.channelAddress = channelAddress;
    student.channelConfirmedAt = pairing.confirmedAt;
    student.updatedAt = pairing.confirmedAt;

    await this.writeMessagingEvent({
      provider: "photon",
      providerEventId,
      studentId: student.id,
      direction: "inbound",
      channelType,
      channelAddress,
      eventType: "pairing_confirmed",
      deliveryStatus: "received",
      metadata,
    });
    await this.ensureStudentThread(student.id, channelAddress, { trigger: "pairing_confirmed", channelType });
    await this.writeAuditEvent(student.id, "channel_confirmed", "provider", { channelType });
    return { duplicate: false, student, welcomeNeeded: true };
  }

  async recordInboundMessage({ providerEventId, channelType, channelAddress, text, metadata }) {
    if (this.messagingEvents.has(providerEventId)) {
      return { duplicate: true, student: null, welcomeNeeded: false };
    }
    this.messagingEvents.add(providerEventId);

    const normalizedAddress = normalizeAddress(channelAddress);
    const student = [...this.students.values()].find((item) => normalizeAddress(item.channelAddress) === normalizedAddress && item.channelConfirmedAt) || null;
    await this.writeMessagingEvent({
      provider: "photon",
      providerEventId,
      studentId: student?.id || null,
      direction: "inbound",
      channelType,
      channelAddress,
      eventType: student ? "student_reply" : "unmatched_inbound",
      deliveryStatus: "received",
      metadata: { ...metadata, hasCode: false, previewLength: String(text || "").length },
    });

    if (student) {
      await this.ensureStudentThread(student.id, channelAddress, { trigger: "student_reply", channelType });
      await this.writeAuditEvent(student.id, "student_reply_received", "provider", { channelType });
    }
    return { duplicate: false, student, welcomeNeeded: false, eventType: student ? "student_reply" : "unmatched_inbound" };
  }

  async writeMessagingEvent(event) {
    this.messagingEvents.add(event.providerEventId);
  }

  async markWelcomeSent(studentId, deliveryStatus, metadata = {}) {
    await this.writeMessagingEvent({
      provider: "photon",
      providerEventId: `welcome:${studentId}`,
      studentId,
      direction: "outbound",
      channelType: "sms",
      channelAddress: "",
      eventType: "welcome_message",
      deliveryStatus,
      metadata,
    });
  }

  async getProfileContext(studentId) {
    return this.profileContexts.get(studentId) || { interests: [], projects: "", preferredWork: "", notes: "" };
  }

  async saveProfileContext(studentId, context) {
    this.profileContexts.set(studentId, context);
    await this.writeAuditEvent(studentId, "profile_context_updated", "student", {});
    return context;
  }

  async storeProfileSnapshot(studentId, auth) {
    this.profileSnapshots.push({ studentId, provider: auth.provider, raw: auth.raw, collectedAt: new Date().toISOString() });
  }

  async queueProfileEnrichment(studentId, auth) {
    if (!auth.linkedinProfileUrl) return null;
    const job = {
      studentId,
      provider: "sprite_brightdata",
      profileUrl: auth.linkedinProfileUrl,
      status: "pending_provider_setup",
      metadata: { source: auth.source },
      updatedAt: new Date().toISOString(),
    };
    this.profileEnrichmentJobs.set(`${studentId}:sprite_brightdata`, job);
    await this.writeAuditEvent(studentId, "profile_enrichment_job_noted", "system", { provider: job.provider, status: job.status });
    return job;
  }

  async ensureStudentThread(studentId, channelAddress, metadata = {}) {
    const threadKey = `student:${studentId}:phone:${normalizeAddress(channelAddress)}`;
    const existing = this.studentThreads.get(threadKey);
    const thread = {
      id: existing?.id || randomUUID(),
      studentId,
      provider: "cognee",
      threadKey,
      externalThreadId: existing?.externalThreadId || "",
      channelAddress,
      status: "pending_provider_setup",
      metadata: { ...(existing?.metadata || {}), ...metadata },
      updatedAt: new Date().toISOString(),
      createdAt: existing?.createdAt || new Date().toISOString(),
    };
    this.studentThreads.set(threadKey, thread);
    await this.writeAuditEvent(studentId, "student_thread_noted", "system", { provider: thread.provider, status: thread.status });
    return thread;
  }

  async writeConsent(studentId, consentType, granted, source) {
    this.consents.push({ studentId, consentType, granted, source, createdAt: new Date().toISOString() });
  }

  async writeAuditEvent(studentId, eventType, actor, metadata = {}) {
    this.auditEvents.push({ studentId, eventType, actor, metadata, createdAt: new Date().toISOString() });
  }

  // v1.2 Phase 04 (AGENT-01) — in-memory mirror of writeInboundMessage.
  // Used by dev/test mode (no DATABASE_URL). Returns null so the Spectrum
  // handler's fire-and-forget triggerWorkflow path is a no-op without DB.
  // The verify-app.mjs smoke suite never hits this — it tests against
  // /webhooks/photon which uses PostgresStore — but defensive coverage
  // prevents a crash if someone wires it up in a memory-only environment.
  async writeInboundMessage(_args) {
    return null;
  }

  // ─── Inbound email pipeline (v1.2 Phase 03 + EMAIL-03 scope-add) ───────────
  // Real implementation lives in PostgresStore.recordEmailInbound. This stub
  // exists so dev mode (no DATABASE_URL) doesn't crash the smoke suite if
  // POST /webhooks/email is ever exercised against an in-memory store.
  //
  // v1.2 EMAIL-03 (scope-add 2026-05-16): the optional conversationId
  // arg, when supplied, is written into the in-memory mirror's
  // metadata.conversation_id so the smoke suite can assert deterministic
  // threading without standing up Postgres.
  async recordEmailInbound({ from, to, subject, body, ts, conversationId }) {
    const channelAddress = String(from || "")
      .match(/<([^>]+)>/)?.[1]
      ?.toLowerCase() ?? String(from || "").trim().toLowerCase();
    const providerEventId = `email:${channelAddress || "unknown"}:${ts || Date.now()}`;
    const inboundId = randomUUID();
    const metadata = {
      from: String(from || ""),
      to: String(to || ""),
      subject: String(subject || ""),
      providerEventId,
      ...(conversationId ? { conversation_id: conversationId } : {}),
    };
    this.inboundMessages.push({
      id: inboundId,
      provider: "email",
      channelAddress,
      body: String(body || ""),
      metadata,
      createdAt: new Date().toISOString(),
    });
    this.auditEvents.push({
      studentId: null,
      eventType: "startup_email_received",
      actor: "provider",
      metadata: { provider: "email", channelAddress, subject: String(subject || ""), providerEventId, conversationId: conversationId || null },
      createdAt: new Date().toISOString(),
    });
    return {
      inboundId,
      startupId: null,
      memberId: null,
      duplicate: false,
      eventType: "startup_email_received",
      conversationId: conversationId || null,
    };
  }

  // ─── v1.2 Phase 05 — operator approval gate (MemoryStore) ──────────────────
  //
  // These methods mirror the PostgresStore surface so the smoke suite can
  // run without DATABASE_URL. Behavior diverges only at the JOIN level:
  // MemoryStore returns drafts with shallow context (student_name, etc.)
  // when callers explicitly seed those fields via insertDraftForTest.
  //
  // Insert helper used by smoke-ops.mjs to inject a pending draft without
  // depending on Phase 04's full inbound → workflow → draft pipeline.

  async insertDraftForTest(input) {
    const now = new Date().toISOString();
    const id = input.id || randomUUID();
    const draft = {
      id,
      conversation_id: input.conversation_id || null,
      inbound_message_id: input.inbound_message_id || null,
      recipient_type: input.recipient_type || "student",
      channel: input.channel || "sms",
      channel_address: input.channel_address || "+15555550100",
      body: input.body || "",
      status: input.status || "pending_review",
      operator_id: input.operator_id || null,
      operator_note: input.operator_note || null,
      sent_at: input.sent_at || null,
      provider_message_id: input.provider_message_id || null,
      agent_metadata: input.agent_metadata || {},
      edited_body: input.edited_body || null,
      created_at: now,
      updated_at: now,
      // Denormalized context (only memory mode — Postgres JOINs do this).
      student_name: input.student_name || null,
      startup_name: input.startup_name || null,
      role_title: input.role_title || null,
    };
    this.drafts.set(id, draft);
    return draft;
  }

  // Autonomy pivot 2026-05-17: listPendingDrafts is gone (it filtered on
  // status='pending_review', which is no longer the default state).
  // listAllDrafts returns every draft regardless of status, newest first,
  // for the read-only audit log.
  async listAllDrafts({ type, limit = 50, offset = 0 } = {}) {
    let rows = [...this.drafts.values()];
    if (type) rows = rows.filter((d) => d.recipient_type === type);
    rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return rows.slice(offset, offset + limit);
  }

  // Back-compat shim for the smoke suite & any external import.
  async listPendingDrafts(opts) {
    return this.listAllDrafts(opts);
  }

  async getDraftById(id) {
    return this.drafts.get(id) || null;
  }

  async getConversationContext(conversationId) {
    // MemoryStore: context is denormalized onto the draft row. The route
    // layer reads those fields directly, so this returns an empty stub.
    void conversationId;
    return null;
  }

  async getPriorMessages(conversationId, limit = 10) {
    void conversationId;
    void limit;
    return [];
  }

  async updateDraftStatus(id, patch) {
    const draft = this.drafts.get(id);
    if (!draft) return null;
    const now = new Date().toISOString();
    const updated = { ...draft, ...patch, updated_at: now };
    this.drafts.set(id, updated);
    return updated;
  }

  async recordDraftFeedback({ draftId, operatorId, feedbackType, originalBody, correctedBody, reason }) {
    const row = {
      id: randomUUID(),
      draft_id: draftId,
      operator_id: operatorId,
      feedback_type: feedbackType,
      original_body: originalBody,
      corrected_body: correctedBody || null,
      reason: reason || null,
      created_at: new Date().toISOString(),
    };
    this.draftFeedback.push(row);
    return row;
  }

  async listDraftFeedback({ limit = 100, feedbackType } = {}) {
    // Newest first; enrich with denormalized fields from the draft.
    // Autonomy pivot 2026-05-17: optional feedbackType filter (default
    // 'flagged' from the route layer; null returns everything for diag).
    let rows = [...this.draftFeedback];
    if (feedbackType) rows = rows.filter((r) => r.feedback_type === feedbackType);
    return rows
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit)
      .map((row) => {
        const d = this.drafts.get(row.draft_id);
        return {
          ...row,
          recipient_type: d?.recipient_type || null,
          channel: d?.channel || null,
          student_name: d?.student_name || null,
          startup_name: d?.startup_name || null,
          role_title: d?.role_title || null,
        };
      });
  }

  async writeDraftSendFailedAudit({ draftId, channel, error }) {
    this.auditEvents.push({
      studentId: null,
      eventType: "draft_send_failed",
      actor: "operator",
      metadata: { draftId, channel, error },
      createdAt: new Date().toISOString(),
    });
  }
}

class PostgresStore {
  constructor(databaseUrl) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl.includes("sslmode=disable") ? false : { rejectUnauthorized: false },
    });
  }

  async upsertStudentFromAuth(auth) {
    const result = await this.pool.query(
      `insert into students (clerk_user_id, email, name, linkedin_profile_url, status)
       values ($1, $2, $3, $4, 'linkedin_connected')
       on conflict (clerk_user_id) do update set
         email = coalesce(nullif(excluded.email, ''), students.email),
         name = coalesce(nullif(excluded.name, ''), students.name),
         linkedin_profile_url = coalesce(nullif(excluded.linkedin_profile_url, ''), students.linkedin_profile_url),
         updated_at = now()
       returning *`,
      [auth.clerkUserId, auth.email, auth.name, auth.linkedinProfileUrl],
    );
    const student = mapStudent(result.rows[0]);

    await this.pool.query(
      `insert into waitlist_status (student_id, status, source)
       values ($1, 'linkedin_connected', $2)
       on conflict (student_id) do update set status = excluded.status, updated_at = now()`,
      [student.id, auth.source],
    );
    await this.storeProfileSnapshot(student.id, auth);
    await this.queueProfileEnrichment(student.id, auth);
    await this.writeConsent(student.id, "linkedin_oauth_profile", true, auth.source);
    await this.writeAuditEvent(student.id, "student_upserted", "system", { source: auth.source });
    return student;
  }

  async getStudentByClerkId(clerkUserId) {
    const result = await this.pool.query("select * from students where clerk_user_id = $1", [clerkUserId]);
    return result.rows[0] ? mapStudent(result.rows[0]) : null;
  }

  async createOrRefreshPairingCode(studentId) {
    const active = await this.pool.query(
      `select * from channel_pairing_codes
       where student_id = $1 and status = 'active' and expires_at > now()
       order by created_at desc
       limit 1`,
      [studentId],
    );
    if (active.rows[0]) return mapPairing(active.rows[0]);
    return this.insertPairingCode(studentId);
  }

  async expireAndCreatePairingCode(studentId) {
    await this.pool.query("update channel_pairing_codes set status = 'expired' where student_id = $1 and status = 'active'", [studentId]);
    return this.insertPairingCode(studentId);
  }

  async insertPairingCode(studentId) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const result = await this.pool.query(
          `insert into channel_pairing_codes (student_id, code, expires_at)
           values ($1, $2, now() + interval '15 minutes')
           returning *`,
          [studentId, createPairingCode()],
        );
        await this.writeAuditEvent(studentId, "pairing_code_created", "system", { expiresInMinutes: 15 });
        return mapPairing(result.rows[0]);
      } catch (error) {
        if (error.code !== "23505") throw error;
      }
    }
    throw new Error("pairing_code_generation_failed");
  }

  async confirmPairingCode({ code, providerEventId, channelType, channelAddress, metadata, provider = "spectrum" }) {
    // v1.2 Phase 04, Flag 3 fix: previously the dedup SELECT and the
    // messaging_events INSERT both hardcoded provider='photon'. Now the
    // provider is parameterized so a Telnyx adapter (or any future SMS
    // provider seam) can use the same store path without cross-provider
    // dedup collisions. Default 'spectrum' preserves current v1.1/v1.2
    // call sites that omit the parameter.
    const duplicate = await this.pool.query("select id from messaging_events where provider = $1 and provider_event_id = $2", [provider, providerEventId]);
    if (duplicate.rows[0]) return { duplicate: true, student: null, welcomeNeeded: false };

    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const pairingResult = await client.query(
        `select * from channel_pairing_codes
         where code = $1 and status = 'active' and expires_at > now()
         for update`,
        [code],
      );
      const pairing = pairingResult.rows[0];
      if (!pairing) {
        await client.query("rollback");
        return { duplicate: false, student: null, welcomeNeeded: false, error: "pairing_code_invalid" };
      }

      await client.query("update channel_pairing_codes set status = 'confirmed', confirmed_at = now() where id = $1", [pairing.id]);
      const studentResult = await client.query(
        `update students set status = 'channel_confirmed', channel_type = $2, channel_address = $3, channel_confirmed_at = now(), updated_at = now()
         where id = $1
         returning *`,
        [pairing.student_id, channelType, channelAddress],
      );
      await client.query(
        `insert into messaging_events (provider, provider_event_id, student_id, direction, channel_type, channel_address, event_type, delivery_status, metadata)
         values ($1, $2, $3, 'inbound', $4, $5, 'pairing_confirmed', 'received', $6)`,
        [provider, providerEventId, pairing.student_id, channelType, channelAddress, metadata],
      );
      await client.query(
        `insert into audit_events (student_id, event_type, actor, metadata)
         values ($1, 'channel_confirmed', 'provider', $2)`,
        [pairing.student_id, { channelType }],
      );
      await this.ensureStudentThread(pairing.student_id, channelAddress, { trigger: "pairing_confirmed", channelType }, client);
      await client.query("commit");
      return { duplicate: false, student: mapStudent(studentResult.rows[0]), welcomeNeeded: true };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async recordInboundMessage({ providerEventId, channelType, channelAddress, text, metadata }) {
    const duplicate = await this.pool.query("select id from messaging_events where provider = 'photon' and provider_event_id = $1", [providerEventId]);
    if (duplicate.rows[0]) return { duplicate: true, student: null, welcomeNeeded: false };

    const studentResult = await this.pool.query(
      `select * from students
       where regexp_replace(coalesce(channel_address, ''), '[^0-9+]', '', 'g') = $1
         and channel_confirmed_at is not null
       order by updated_at desc
       limit 1`,
      [normalizeAddress(channelAddress)],
    );
    const student = studentResult.rows[0] ? mapStudent(studentResult.rows[0]) : null;
    const eventType = student ? "student_reply" : "unmatched_inbound";

    await this.writeMessagingEvent({
      provider: "photon",
      providerEventId,
      studentId: student?.id || null,
      direction: "inbound",
      channelType,
      channelAddress,
      eventType,
      deliveryStatus: "received",
      metadata: { ...metadata, hasCode: false, previewLength: String(text || "").length },
    });
    if (student) {
      await this.ensureStudentThread(student.id, channelAddress, { trigger: "student_reply", channelType });
      await this.writeAuditEvent(student.id, "student_reply_received", "provider", { channelType });
    }
    return { duplicate: false, student, welcomeNeeded: false, eventType };
  }

  async writeMessagingEvent(event) {
    await this.pool.query(
      `insert into messaging_events (provider, provider_event_id, student_id, direction, channel_type, channel_address, event_type, delivery_status, metadata)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (provider, provider_event_id) do nothing`,
      [event.provider, event.providerEventId, event.studentId, event.direction, event.channelType, event.channelAddress, event.eventType, event.deliveryStatus, event.metadata || {}],
    );
  }

  async markWelcomeSent(studentId, deliveryStatus, metadata = {}) {
    await this.writeMessagingEvent({
      provider: "photon",
      providerEventId: `welcome:${studentId}`,
      studentId,
      direction: "outbound",
      channelType: "sms",
      channelAddress: "",
      eventType: "welcome_message",
      deliveryStatus,
      metadata,
    });
  }

  async getProfileContext(studentId) {
    const result = await this.pool.query("select * from student_profile_context where student_id = $1", [studentId]);
    const row = result.rows[0];
    return row ? { interests: row.interests || [], projects: row.projects || "", preferredWork: row.preferred_work || "", notes: row.notes || "" } : { interests: [], projects: "", preferredWork: "", notes: "" };
  }

  async saveProfileContext(studentId, context) {
    const result = await this.pool.query(
      `insert into student_profile_context (student_id, interests, projects, preferred_work, notes)
       values ($1, $2, $3, $4, $5)
       on conflict (student_id) do update set
         interests = excluded.interests,
         projects = excluded.projects,
         preferred_work = excluded.preferred_work,
         notes = excluded.notes,
         updated_at = now()
       returning *`,
      [studentId, context.interests, context.projects, context.preferredWork, context.notes],
    );
    await this.writeAuditEvent(studentId, "profile_context_updated", "student", {});

    // v1.2 Phase 04 (AGENT-03): fire student embedding write as background.
    // .catch(logEmbedErr), NOT awaited — a failing proxy-Worker call must
    // not block the user-visible profile save. PITFALLS-aware: keeps the
    // hot path fast.
    const flattened = flattenProfileForEmbedding(context);
    if (flattened) {
      writeStudentEmbedding(this.pool, studentId, flattened).catch(logEmbedErr);
    }

    return result.rows[0];
  }

  // v1.2 Phase 04 (AGENT-01): canonical entry point for inbound messages that
  // the agent workflow will consume. Coexists with recordInboundMessage (the
  // v1.1/Phase 02 path that writes messaging_events) — both fire on the
  // Spectrum handler so:
  //   • messaging_events still captures observability + dedup as before
  //     (Phase 01/02 reports, audit trail).
  //   • inbound_messages becomes the agent-consumer queue (Phase 04+).
  // Idempotency is enforced by inbound_messages_provider_event_uidx (partial
  // unique on provider+provider_event_id where provider_event_id is set).
  // Returns the inserted id, or null when on-conflict skips the insert.
  async writeInboundMessage({ provider, providerEventId, channelType, channelAddress, studentId, startupId, body, metadata }) {
    const r = await this.pool.query(
      `insert into inbound_messages
         (provider, provider_event_id, channel_type, channel_address,
          student_id, startup_id, body, metadata)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (provider, provider_event_id)
         where provider_event_id is not null
         do nothing
       returning id`,
      [
        provider,
        providerEventId || null,
        channelType,
        channelAddress || null,
        studentId || null,
        startupId || null,
        String(body || ""),
        metadata || {},
      ],
    );
    return r.rows[0]?.id || null;
  }

  async storeProfileSnapshot(studentId, auth) {
    await this.pool.query(
      `insert into profile_snapshots (student_id, provider, provider_user_id, display_name, profile_url, photo_url, raw_metadata)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [studentId, auth.provider, auth.clerkUserId, auth.name, auth.linkedinProfileUrl, auth.imageUrl, auth.raw],
    );
  }

  async queueProfileEnrichment(studentId, auth) {
    if (!auth.linkedinProfileUrl) return null;
    const result = await this.pool.query(
      `insert into profile_enrichment_jobs (student_id, provider, profile_url, status, metadata)
       values ($1, 'sprite_brightdata', $2, 'pending_provider_setup', $3)
       on conflict (student_id, provider) do update set
         profile_url = excluded.profile_url,
         status = excluded.status,
         metadata = excluded.metadata,
         updated_at = now()
       returning *`,
      [studentId, auth.linkedinProfileUrl, { source: auth.source }],
    );
    await this.writeAuditEvent(studentId, "profile_enrichment_job_noted", "system", { provider: "sprite_brightdata", status: "pending_provider_setup" });
    return result.rows[0];
  }

  async writeConsent(studentId, consentType, granted, source) {
    await this.pool.query(
      `insert into consents (student_id, consent_type, granted, source)
       values ($1, $2, $3, $4)
       on conflict (student_id, consent_type) do update set granted = excluded.granted, source = excluded.source, created_at = now()`,
      [studentId, consentType, granted, source],
    );
  }

  async writeAuditEvent(studentId, eventType, actor, metadata = {}) {
    await this.pool.query("insert into audit_events (student_id, event_type, actor, metadata) values ($1, $2, $3, $4)", [studentId, eventType, actor, metadata]);
  }

  async ensureStudentThread(studentId, channelAddress, metadata = {}, client = this.pool) {
    const threadKey = `student:${studentId}:phone:${normalizeAddress(channelAddress)}`;
    const result = await client.query(
      `insert into student_threads (student_id, provider, thread_key, channel_address, status, metadata)
       values ($1, 'cognee', $2, $3, 'pending_provider_setup', $4)
       on conflict (provider, thread_key) do update set
         channel_address = excluded.channel_address,
         metadata = student_threads.metadata || excluded.metadata,
         updated_at = now()
       returning *`,
      [studentId, threadKey, channelAddress, metadata],
    );
    if (client === this.pool) {
      await this.writeAuditEvent(studentId, "student_thread_noted", "system", { provider: "cognee", status: "pending_provider_setup" });
    } else {
      await client.query("insert into audit_events (student_id, event_type, actor, metadata) values ($1, 'student_thread_noted', 'system', $2)", [
        studentId,
        { provider: "cognee", status: "pending_provider_setup" },
      ]);
    }
    return result.rows[0];
  }

  // ─── Startup identity (v1.2) ───────────────────────────────────────────────

  async getStartupByClerkUserId(clerkUserId) {
    const { rows } = await this.pool.query(
      `select s.*, sm.role as member_role, sm.id as member_id
       from startups s
       join startup_members sm on sm.startup_id = s.id
       where sm.clerk_user_id = $1 limit 1`,
      [clerkUserId],
    );
    return rows[0] || null;
  }

  async createStartupWithFounder({ clerkUserId, name, website, email, founderName }) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const {
        rows: [startup],
      } = await client.query(
        `insert into startups (name, website, status)
         values ($1, $2, 'onboarding')
         returning *`,
        [name, website || null],
      );
      await client.query(
        `insert into startup_members (startup_id, clerk_user_id, role, email, name)
         values ($1, $2, 'founder', $3, $4)
         on conflict (clerk_user_id) do nothing`,
        [startup.id, clerkUserId, email, founderName || null],
      );
      await client.query("commit");
      return startup;
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }

  async recordStartupConsent({ startupId, consentType, granted, grantedByClerkUserId }) {
    await this.pool.query(
      `insert into startup_consents (startup_id, consent_type, granted, granted_by_clerk_user_id)
       values ($1, $2, $3, $4)
       on conflict (startup_id, consent_type) do update set granted = $3`,
      [startupId, consentType, granted, grantedByClerkUserId],
    );
  }

  async hasStartupConsent(startupId, consentType) {
    const { rows } = await this.pool.query(
      `select id from startup_consents
       where startup_id = $1 and consent_type = $2 and granted = true limit 1`,
      [startupId, consentType],
    );
    return rows.length > 0;
  }

  async activateStartup(startupId) {
    await this.pool.query(
      `update startups set status = 'active', updated_at = now() where id = $1`,
      [startupId],
    );
  }

  // ─── Roles catalog (v1.2) ──────────────────────────────────────────────────

  async getRolesByStartup(startupId) {
    const { rows } = await this.pool.query(
      `select * from roles where startup_id = $1 order by created_at desc`,
      [startupId],
    );
    return rows;
  }

  async getRoleById(roleId, startupId) {
    const { rows } = await this.pool.query(
      `select * from roles where id = $1 and startup_id = $2 limit 1`,
      [roleId, startupId],
    );
    return rows[0] || null;
  }

  async createRole({ startupId, title, description, requirements, location, compRange }) {
    const { rows } = await this.pool.query(
      `insert into roles (startup_id, title, description, requirements, location, comp_range, status)
       values ($1, $2, $3, $4, $5, $6, 'active') returning *`,
      [startupId, title, description || "", requirements || "", location || null, compRange || null],
    );
    return rows[0];
  }

  async updateRole(roleId, startupId, { title, description, requirements, location, compRange }) {
    const { rows } = await this.pool.query(
      `update roles set title=$3, description=$4, requirements=$5, location=$6, comp_range=$7,
       updated_at=now()
       where id=$1 and startup_id=$2 returning *`,
      [roleId, startupId, title, description || "", requirements || "", location || null, compRange || null],
    );
    return rows[0] || null;
  }

  async pauseRole(roleId, startupId) {
    await this.pool.query(
      `update roles set status='paused', updated_at=now() where id=$1 and startup_id=$2`,
      [roleId, startupId],
    );
  }

  // ─── Inbound email pipeline (v1.2 Phase 03) ────────────────────────────────
  //
  // recordEmailInbound is the canonical Fly-side handler for inbound email
  // events that arrive from the CF Email Worker via POST /webhooks/email.
  // It:
  //   1. Writes an inbound_messages row (provider='email', channel_type='email').
  //   2. Looks up startup_id by matching the sender's From: address against
  //      startup_members.email (case-insensitive). Unknown senders are NOT
  //      a failure — they get a null startup_id and the audit event records
  //      'unmatched_startup_email' so the operator can resolve manually.
  //   3. Writes an audit_events row with event_type='startup_email_received'.
  //
  // Idempotency: provider_event_id is built from (from + ts) so the same
  // upstream message replayed by the Worker doesn't create duplicate rows.
  // The partial unique index inbound_messages_provider_event_uidx enforces
  // this at the DB level.
  async recordEmailInbound({ from, to, subject, body, ts, conversationId }) {
    const fromAddr = String(from || "").trim();
    const channelAddress = extractEmailAddress(fromAddr).toLowerCase();

    // Lookup the startup whose member has this email (case-insensitive).
    let startupId = null;
    let memberId = null;
    if (channelAddress) {
      const { rows } = await this.pool.query(
        `select id, startup_id from startup_members
         where lower(email) = $1 limit 1`,
        [channelAddress],
      );
      if (rows[0]) {
        startupId = rows[0].startup_id;
        memberId = rows[0].id;
      }
    }

    // v1.2 EMAIL-03: if the Worker passed a conversation_id (parsed from
    // `conv-{uuid}@internjobs.ai`), prefer it as the deterministic routing
    // key. We DON'T override startup_id from the conversation row here —
    // that's the Phase 04 workflow's job; we just stamp the id into
    // inbound_messages.metadata so the workflow can load the conversation
    // directly without a From-address lookup.
    const providerEventId = `email:${channelAddress || "unknown"}:${ts || Date.now()}`;
    const metadata = {
      from: fromAddr,
      to: String(to || ""),
      subject: String(subject || ""),
      receivedAt: new Date().toISOString(),
      ...(conversationId ? { conversation_id: conversationId } : {}),
    };

    // Insert the inbound_messages row. on conflict do nothing makes a
    // Worker retry idempotent.
    const inserted = await this.pool.query(
      `insert into inbound_messages
         (provider, provider_event_id, channel_type, channel_address,
          startup_id, direction, body, metadata)
       values ('email', $1, 'email', $2, $3, 'inbound', $4, $5)
       on conflict (provider, provider_event_id)
         where provider_event_id is not null
         do nothing
       returning id`,
      [
        providerEventId,
        channelAddress || null,
        startupId,
        String(body || ""),
        metadata,
      ],
    );

    const inboundId = inserted.rows[0]?.id || null;
    const duplicate = !inboundId;

    // audit_events: student_id-keyed table, so for startup-side events we
    // pass null student_id. The metadata captures startup_id when known.
    // EMAIL-03: when conversationId is set, emit a distinct event type so
    // operators can see which inbound emails arrived via the deterministic
    // per-conv alias path vs the legacy From-address lookup.
    const eventType = conversationId
      ? "startup_email_received_by_alias"
      : startupId
        ? "startup_email_received"
        : "unmatched_startup_email";
    await this.pool.query(
      `insert into audit_events (student_id, event_type, actor, metadata)
       values (null, $1, 'provider', $2)`,
      [
        eventType,
        {
          provider: "email",
          channelAddress,
          subject: String(subject || ""),
          startupId,
          memberId,
          inboundId,
          duplicate,
          conversationId: conversationId || null,
        },
      ],
    );

    return { inboundId, startupId, memberId, duplicate, eventType, conversationId: conversationId || null };
  }

  // ─── v1.2 Phase 05 — operator approval gate (PostgresStore) ────────────────
  //
  // listPendingDrafts joins drafts → conversations → students/startups/roles so
  // the queue view can render names + role title in a single round trip.
  // Filters: status='pending_review' (the agent-write state from Phase 04),
  // optional recipient_type, LIMIT/OFFSET.

  // Autonomy pivot 2026-05-17: listAllDrafts returns every draft regardless
  // of status (sent/failed/sending/flagged), newest first. Replaces the
  // prior listPendingDrafts which filtered on status='pending_review'.
  async listAllDrafts({ type, limit = 50, offset = 0 } = {}) {
    const params = [limit, offset];
    let typeClause = "";
    if (type === "student" || type === "startup") {
      params.push(type);
      typeClause = ` where d.recipient_type = $${params.length}`;
    }
    const { rows } = await this.pool.query(
      `select d.id, d.recipient_type, d.channel, d.channel_address, d.body, d.status,
              d.sent_at, d.provider_message_id, d.created_at, d.updated_at, d.agent_metadata,
              s.name as student_name, st.name as startup_name, r.title as role_title
         from drafts d
         left join conversations c on d.conversation_id = c.id
         left join students s on c.student_id = s.id
         left join startups st on c.startup_id = st.id
         left join roles r on c.role_id = r.id
        ${typeClause}
        order by d.created_at desc
        limit $1 offset $2`,
      params,
    );
    return rows;
  }

  // Back-compat alias.
  async listPendingDrafts(opts) {
    return this.listAllDrafts(opts);
  }

  async getDraftById(id) {
    const { rows } = await this.pool.query(
      `select d.*, s.name as student_name, st.name as startup_name, r.title as role_title,
              r.requirements as role_requirements
         from drafts d
         left join conversations c on d.conversation_id = c.id
         left join students s on c.student_id = s.id
         left join startups st on c.startup_id = st.id
         left join roles r on c.role_id = r.id
        where d.id = $1
        limit 1`,
      [id],
    );
    return rows[0] || null;
  }

  async getPriorMessages(conversationId, limit = 10) {
    if (!conversationId) return [];
    // We don't have a single canonical "messages on a conversation" table;
    // inbound_messages is the inbound side, drafts the outbound side. We
    // union them as a synthetic timeline for the operator to read.
    const { rows } = await this.pool.query(
      `(
         select 'inbound' as direction, body, created_at
           from inbound_messages
          where id in (
            select inbound_message_id from drafts where conversation_id = $1 and inbound_message_id is not null
          )
       )
       union all
       (
         select 'outbound' as direction, coalesce(operator_note, '') || ' ' || body as body, sent_at as created_at
           from drafts
          where conversation_id = $1 and status = 'sent' and sent_at is not null
       )
       order by created_at desc
       limit $2`,
      [conversationId, limit],
    );
    return rows;
  }

  async updateDraftStatus(id, patch) {
    // Build a partial-update statement based on supplied fields. Whitelist
    // the columns we accept so callers can't sneak in arbitrary SQL.
    const allowed = ["status", "operator_id", "operator_note", "sent_at", "provider_message_id", "edited_body"];
    const setParts = [];
    const params = [id];
    for (const col of allowed) {
      if (Object.prototype.hasOwnProperty.call(patch, col)) {
        params.push(patch[col]);
        setParts.push(`${col} = $${params.length}`);
      }
    }
    if (setParts.length === 0) return this.getDraftById(id);
    setParts.push("updated_at = now()");
    const sql = `update drafts set ${setParts.join(", ")} where id = $1 returning *`;
    const { rows } = await this.pool.query(sql, params);
    return rows[0] || null;
  }

  // edited_body is not in the 0004 migration schema for drafts. Phase 05
  // adds it via 0005_v1_2_draft_edits.sql — but to keep this PR migration-light
  // we instead carry the edited body in agent_metadata.edited_body. The
  // updateDraftStatus method strips edited_body from the patch when the
  // schema doesn't accept it. For correctness with the existing schema, we
  // omit edited_body from the allowed list and stuff it into agent_metadata
  // via a separate helper.

  async updateDraftWithEditedBody(id, { editedBody, operatorId }) {
    const { rows } = await this.pool.query(
      `update drafts
          set body = $2,
              operator_id = $3,
              status = 'approved',
              updated_at = now(),
              agent_metadata = coalesce(agent_metadata, '{}'::jsonb) || jsonb_build_object('edited_by_operator', true)
        where id = $1
        returning *`,
      [id, editedBody, operatorId],
    );
    return rows[0] || null;
  }

  async recordDraftFeedback({ draftId, operatorId, feedbackType, originalBody, correctedBody, reason }) {
    const { rows } = await this.pool.query(
      `insert into draft_feedback
         (draft_id, operator_id, feedback_type, original_body, corrected_body, reason)
       values ($1, $2, $3, $4, $5, $6)
       returning *`,
      [draftId, operatorId, feedbackType, originalBody, correctedBody || null, reason || null],
    );
    return rows[0];
  }

  async listDraftFeedback({ limit = 100, feedbackType } = {}) {
    const params = [limit];
    let typeClause = "";
    if (feedbackType) {
      params.push(feedbackType);
      typeClause = ` where df.feedback_type = $${params.length}`;
    }
    const { rows } = await this.pool.query(
      `select df.id, df.feedback_type, df.original_body, df.corrected_body, df.reason,
              df.created_at, df.operator_id,
              d.recipient_type, d.channel,
              s.name as student_name, st.name as startup_name, r.title as role_title
         from draft_feedback df
         join drafts d on df.draft_id = d.id
         left join conversations c on d.conversation_id = c.id
         left join students s on c.student_id = s.id
         left join startups st on c.startup_id = st.id
         left join roles r on c.role_id = r.id
        ${typeClause}
        order by df.created_at desc
        limit $1`,
      params,
    );
    return rows;
  }

  async writeDraftSendFailedAudit({ draftId, channel, error }) {
    await this.pool.query(
      `insert into audit_events (student_id, event_type, actor, metadata)
       values (null, 'draft_send_failed', 'operator', $1)`,
      [{ draftId, channel, error: String(error || "").slice(0, 500) }],
    );
  }

  // Used only by the smoke suite — PostgresStore version is a thin INSERT.
  // In production drafts are written by Phase 04's workflow.
  async insertDraftForTest(input) {
    const { rows } = await this.pool.query(
      `insert into drafts
         (recipient_type, channel, channel_address, body, status, agent_metadata)
       values ($1, $2, $3, $4, $5, $6)
       returning *`,
      [
        input.recipient_type || "student",
        input.channel || "sms",
        input.channel_address || "+15555550100",
        input.body || "",
        input.status || "pending_review",
        input.agent_metadata || {},
      ],
    );
    return rows[0];
  }
}

// Parse an RFC 5322 From: value down to the bare addr-spec. We don't need
// a full grammar — the two common shapes are:
//   "Jane Doe <jane@example.com>"
//   "jane@example.com"
// We pull anything inside angle brackets if present, otherwise return the
// trimmed input. Lower-casing is the caller's responsibility.
function extractEmailAddress(headerValue) {
  const s = String(headerValue || "").trim();
  const angle = s.match(/<([^>]+)>/);
  if (angle) return angle[1].trim();
  return s;
}

function normalizeAddress(value) {
  return String(value || "").replace(/[^\d+]/g, "");
}

// v1.2 Phase 04: text used to embed a student's profile context. We
// concatenate the structured fields with labels so the embedding captures
// both content and field role (a project description means something
// different from a notes field).
function flattenProfileForEmbedding(context) {
  if (!context) return "";
  const parts = [];
  if (Array.isArray(context.interests) && context.interests.length) {
    parts.push("interests: " + context.interests.join(", "));
  }
  if (context.projects) parts.push("projects: " + context.projects);
  if (context.preferredWork) parts.push("preferred work: " + context.preferredWork);
  if (context.notes) parts.push("notes: " + context.notes);
  return parts.join("\n").trim();
}

function mapStudent(row) {
  return {
    id: row.id,
    clerkUserId: row.clerk_user_id,
    email: row.email || "",
    name: row.name || "",
    linkedinProfileUrl: row.linkedin_profile_url || "",
    status: row.status,
    channelType: row.channel_type || "",
    channelAddress: row.channel_address || "",
    channelConfirmedAt: row.channel_confirmed_at ? new Date(row.channel_confirmed_at).toISOString() : "",
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function mapPairing(row) {
  return {
    id: row.id,
    studentId: row.student_id,
    code: row.code,
    status: row.status,
    expiresAt: new Date(row.expires_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
    confirmedAt: row.confirmed_at ? new Date(row.confirmed_at).toISOString() : "",
  };
}
