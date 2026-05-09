import { randomUUID, createHash, randomBytes } from "node:crypto";
import pg from "pg";

const { Pool } = pg;

export function createStore(config) {
  if (config.databaseUrl) return new PostgresStore(config.databaseUrl);
  return new MemoryStore();
}

export function createPairingCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "IJ-";
  const bytes = randomBytes(6);
  for (const byte of bytes) code += alphabet[byte % alphabet.length];
  return code;
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
    this.auditEvents = [];
    this.profileSnapshots = [];
    this.consents = [];
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
    await this.writeAuditEvent(student.id, "channel_confirmed", "provider", { channelType });
    return { duplicate: false, student, welcomeNeeded: true };
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

  async writeConsent(studentId, consentType, granted, source) {
    this.consents.push({ studentId, consentType, granted, source, createdAt: new Date().toISOString() });
  }

  async writeAuditEvent(studentId, eventType, actor, metadata = {}) {
    this.auditEvents.push({ studentId, eventType, actor, metadata, createdAt: new Date().toISOString() });
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

  async confirmPairingCode({ code, providerEventId, channelType, channelAddress, metadata }) {
    const duplicate = await this.pool.query("select id from messaging_events where provider = 'photon' and provider_event_id = $1", [providerEventId]);
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
         values ('photon', $1, $2, 'inbound', $3, $4, 'pairing_confirmed', 'received', $5)`,
        [providerEventId, pairing.student_id, channelType, channelAddress, metadata],
      );
      await client.query(
        `insert into audit_events (student_id, event_type, actor, metadata)
         values ($1, 'channel_confirmed', 'provider', $2)`,
        [pairing.student_id, { channelType }],
      );
      await client.query("commit");
      return { duplicate: false, student: mapStudent(studentResult.rows[0]), welcomeNeeded: true };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
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
    return result.rows[0];
  }

  async storeProfileSnapshot(studentId, auth) {
    await this.pool.query(
      `insert into profile_snapshots (student_id, provider, provider_user_id, display_name, profile_url, photo_url, raw_metadata)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [studentId, auth.provider, auth.clerkUserId, auth.name, auth.linkedinProfileUrl, auth.imageUrl, auth.raw],
    );
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
