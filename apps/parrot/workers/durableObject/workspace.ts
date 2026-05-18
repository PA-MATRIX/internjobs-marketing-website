// v1.2 Phase 10 Wave 2b: WorkspaceDO — singleton DO for workspace-wide state.
//
// Why a separate DO?
//   EmployeeMailboxDO is per-employee (keyed by Clerk user_id). It only ever
//   knows about its own owner. Wave 2b adds two pieces of CROSS-EMPLOYEE
//   state that need a single source of truth:
//     1. The employee directory (who's been invited, what's their workspace
//        email, what's their Clerk user_id, what's their personal email).
//     2. The OIDC bridge for Mattermost — short-lived auth codes and access
//        tokens that ANY signed-in employee can mint when they SSO into MM.
//
// We pin this DO to a single instance (idFromName("workspace")) so all
// reads/writes route to the same SQLite store. This is fine for v1.2 scale
// (single-digit employees) and aligns with the agentic-inbox pattern of
// keeping shared state inside DO storage rather than D1.
//
// Tables:
//   - employees(id, clerk_user_id, workspace_email, personal_email, display_name,
//               status, created_at, updated_at)
//   - oidc_codes(code, clerk_user_id, email, name, picture, client_id,
//                redirect_uri, scope, expires_at, used)
//   - oidc_tokens(token, clerk_user_id, email, name, picture, client_id,
//                 expires_at)

import { DurableObject } from "cloudflare:workers";
import type { Env } from "../types";

export interface EmployeeRecord {
	id: string;
	clerk_user_id: string;
	workspace_email: string;
	personal_email: string;
	display_name: string;
	status: "invited" | "active" | "disabled";
	created_at: string;
	updated_at: string;
}

export interface OidcCodeRecord {
	code: string;
	clerk_user_id: string;
	email: string;
	name: string;
	picture: string | null;
	client_id: string;
	redirect_uri: string;
	scope: string;
	expires_at: number;
	used: number;
}

export interface OidcTokenRecord {
	token: string;
	clerk_user_id: string;
	email: string;
	name: string;
	picture: string | null;
	client_id: string;
	expires_at: number;
}

const WORKSPACE_MIGRATIONS = [
	{
		name: "1_initial",
		sql: `
			CREATE TABLE employees (
				id TEXT PRIMARY KEY,
				clerk_user_id TEXT NOT NULL UNIQUE,
				workspace_email TEXT NOT NULL UNIQUE,
				personal_email TEXT NOT NULL,
				display_name TEXT NOT NULL,
				status TEXT NOT NULL DEFAULT 'invited',
				created_at TEXT NOT NULL DEFAULT (datetime('now')),
				updated_at TEXT NOT NULL DEFAULT (datetime('now'))
			);

			CREATE TABLE oidc_codes (
				code TEXT PRIMARY KEY,
				clerk_user_id TEXT NOT NULL,
				email TEXT NOT NULL,
				name TEXT NOT NULL,
				picture TEXT,
				client_id TEXT NOT NULL,
				redirect_uri TEXT NOT NULL,
				scope TEXT NOT NULL,
				expires_at INTEGER NOT NULL,
				used INTEGER NOT NULL DEFAULT 0
			);

			CREATE TABLE oidc_tokens (
				token TEXT PRIMARY KEY,
				clerk_user_id TEXT NOT NULL,
				email TEXT NOT NULL,
				name TEXT NOT NULL,
				picture TEXT,
				client_id TEXT NOT NULL,
				expires_at INTEGER NOT NULL
			);
		`,
	},
];

function applyWorkspaceMigrations(sql: SqlStorage) {
	sql.exec(`CREATE TABLE IF NOT EXISTS d1_migrations (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL UNIQUE,
		applied_at TEXT NOT NULL DEFAULT (datetime('now'))
	)`);
	for (const migration of WORKSPACE_MIGRATIONS) {
		const applied = [
			...sql.exec(`SELECT 1 FROM d1_migrations WHERE name = ?`, migration.name),
		];
		if (applied.length > 0) continue;
		sql.exec(migration.sql);
		sql.exec(`INSERT INTO d1_migrations (name) VALUES (?)`, migration.name);
	}
}

export class WorkspaceDO extends DurableObject<Env> {
	declare __DURABLE_OBJECT_BRAND: never;

	constructor(state: DurableObjectState, env: Env) {
		super(state, env);
		applyWorkspaceMigrations(this.ctx.storage.sql);
	}

	// ── Employees ───────────────────────────────────────────────────

	async createEmployee(input: {
		clerkUserId: string;
		workspaceEmail: string;
		personalEmail: string;
		displayName: string;
	}): Promise<EmployeeRecord> {
		const id = crypto.randomUUID();
		const now = new Date().toISOString();
		this.ctx.storage.sql.exec(
			`INSERT INTO employees (id, clerk_user_id, workspace_email, personal_email, display_name, status, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, 'invited', ?, ?)`,
			id,
			input.clerkUserId,
			input.workspaceEmail.toLowerCase(),
			input.personalEmail.toLowerCase(),
			input.displayName,
			now,
			now,
		);
		const created = await this.getEmployeeById(id);
		if (!created) throw new Error("createEmployee: row missing after insert");
		return created;
	}

	async getEmployeeById(id: string): Promise<EmployeeRecord | null> {
		const row = [
			...this.ctx.storage.sql.exec(
				`SELECT id, clerk_user_id, workspace_email, personal_email, display_name, status, created_at, updated_at
				 FROM employees WHERE id = ?`,
				id,
			),
		][0] as EmployeeRecord | undefined;
		return row ?? null;
	}

	async getEmployeeByClerkId(clerkUserId: string): Promise<EmployeeRecord | null> {
		const row = [
			...this.ctx.storage.sql.exec(
				`SELECT id, clerk_user_id, workspace_email, personal_email, display_name, status, created_at, updated_at
				 FROM employees WHERE clerk_user_id = ?`,
				clerkUserId,
			),
		][0] as EmployeeRecord | undefined;
		return row ?? null;
	}

	async getEmployeeByWorkspaceEmail(
		workspaceEmail: string,
	): Promise<EmployeeRecord | null> {
		const row = [
			...this.ctx.storage.sql.exec(
				`SELECT id, clerk_user_id, workspace_email, personal_email, display_name, status, created_at, updated_at
				 FROM employees WHERE workspace_email = ?`,
				workspaceEmail.toLowerCase(),
			),
		][0] as EmployeeRecord | undefined;
		return row ?? null;
	}

	async listEmployees(): Promise<EmployeeRecord[]> {
		return [
			...this.ctx.storage.sql.exec(
				`SELECT id, clerk_user_id, workspace_email, personal_email, display_name, status, created_at, updated_at
				 FROM employees ORDER BY created_at DESC`,
			),
		] as EmployeeRecord[];
	}

	async setEmployeeStatus(
		id: string,
		status: EmployeeRecord["status"],
	): Promise<EmployeeRecord | null> {
		const now = new Date().toISOString();
		this.ctx.storage.sql.exec(
			`UPDATE employees SET status = ?, updated_at = ? WHERE id = ?`,
			status,
			now,
			id,
		);
		return this.getEmployeeById(id);
	}

	// ── OIDC codes ──────────────────────────────────────────────────

	async createAuthCode(input: {
		clerkUserId: string;
		email: string;
		name: string;
		picture: string | null;
		clientId: string;
		redirectUri: string;
		scope: string;
		ttlSeconds: number;
	}): Promise<string> {
		const code = crypto.randomUUID().replace(/-/g, "");
		const expiresAt = Math.floor(Date.now() / 1000) + input.ttlSeconds;
		this.ctx.storage.sql.exec(
			`INSERT INTO oidc_codes (code, clerk_user_id, email, name, picture, client_id, redirect_uri, scope, expires_at, used)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
			code,
			input.clerkUserId,
			input.email,
			input.name,
			input.picture,
			input.clientId,
			input.redirectUri,
			input.scope,
			expiresAt,
		);
		return code;
	}

	async consumeAuthCode(
		code: string,
		clientId: string,
		redirectUri: string,
	): Promise<OidcCodeRecord | null> {
		const row = [
			...this.ctx.storage.sql.exec(
				`SELECT * FROM oidc_codes WHERE code = ?`,
				code,
			),
		][0] as OidcCodeRecord | undefined;
		if (!row) return null;
		const now = Math.floor(Date.now() / 1000);
		if (row.used !== 0 || row.expires_at < now) return null;
		if (row.client_id !== clientId) return null;
		if (row.redirect_uri !== redirectUri) return null;
		this.ctx.storage.sql.exec(
			`UPDATE oidc_codes SET used = 1 WHERE code = ?`,
			code,
		);
		return row;
	}

	// ── OIDC access tokens ──────────────────────────────────────────

	async createAccessToken(input: {
		clerkUserId: string;
		email: string;
		name: string;
		picture: string | null;
		clientId: string;
		ttlSeconds: number;
	}): Promise<{ token: string; expiresIn: number }> {
		// 32 random bytes hex = 64 chars opaque token
		const bytes = new Uint8Array(32);
		crypto.getRandomValues(bytes);
		const token = Array.from(bytes)
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("");
		const expiresAt = Math.floor(Date.now() / 1000) + input.ttlSeconds;
		this.ctx.storage.sql.exec(
			`INSERT INTO oidc_tokens (token, clerk_user_id, email, name, picture, client_id, expires_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			token,
			input.clerkUserId,
			input.email,
			input.name,
			input.picture,
			input.clientId,
			expiresAt,
		);
		return { token, expiresIn: input.ttlSeconds };
	}

	async lookupAccessToken(token: string): Promise<OidcTokenRecord | null> {
		const row = [
			...this.ctx.storage.sql.exec(
				`SELECT * FROM oidc_tokens WHERE token = ?`,
				token,
			),
		][0] as OidcTokenRecord | undefined;
		if (!row) return null;
		const now = Math.floor(Date.now() / 1000);
		if (row.expires_at < now) return null;
		return row;
	}

	// ── Maintenance ─────────────────────────────────────────────────

	async sweepExpired(): Promise<{ codes: number; tokens: number }> {
		const now = Math.floor(Date.now() / 1000);
		const codes = this.ctx.storage.sql.exec(
			`DELETE FROM oidc_codes WHERE expires_at < ? OR used = 1`,
			now,
		).rowsWritten;
		const tokens = this.ctx.storage.sql.exec(
			`DELETE FROM oidc_tokens WHERE expires_at < ?`,
			now,
		).rowsWritten;
		return { codes, tokens };
	}
}

/** Resolve the singleton WorkspaceDO stub. */
export function getWorkspaceStub(env: Env): DurableObjectStub<WorkspaceDO> {
	const ns = env.WORKSPACE;
	const id = ns.idFromName("workspace");
	return ns.get(id);
}
