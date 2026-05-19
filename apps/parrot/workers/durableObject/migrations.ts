// v1.2 Phase 10 Wave 1: Parrot DO migrations.
// Same migration runner contract as apps/agentic-inbox so the SQL layer
// stays drop-in compatible. We start with a single consolidated migration
// rather than re-running agentic-inbox's 8 incremental ones, since Parrot
// has no production data to preserve.

export interface Migration {
	name: string;
	sql: string;
}

interface DurableObjectStorage {
	transactionSync: <T>(closure: () => T) => T;
}

export function applyMigrations(
	sql: SqlStorage,
	migrations: Migration[],
	storage?: DurableObjectStorage,
): void {
	sql.exec(`CREATE TABLE IF NOT EXISTS d1_migrations (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL UNIQUE,
		applied_at TEXT NOT NULL DEFAULT (datetime('now'))
	)`);

	for (const migration of migrations) {
		const applied = [
			...sql.exec(
				`SELECT 1 FROM d1_migrations WHERE name = ?`,
				migration.name,
			),
		];
		if (applied.length > 0) continue;

		// DO runtime forbids SQL-level BEGIN/COMMIT — strip them if present.
		let migrationSql = migration.sql.trim();
		migrationSql = migrationSql.replace(/^\s*BEGIN\s+TRANSACTION\s*;?\s*/i, "");
		migrationSql = migrationSql.replace(/\s*COMMIT\s*;?\s*$/i, "");

		const escapedName = migration.name.replace(/'/g, "''");
		const run = () => {
			sql.exec(migrationSql);
			sql.exec(
				`INSERT INTO d1_migrations (name) VALUES ('${escapedName}')`,
			);
		};

		if (storage) {
			storage.transactionSync(run);
		} else {
			run();
		}
	}
}

export const employeeMailboxMigrations: Migration[] = [
	{
		// Consolidated initial schema (equivalent to agentic-inbox migrations 1–8).
		// Parrot is greenfield so we don't need incremental ALTERs.
		name: "1_initial_setup",
		sql: `
			CREATE TABLE folders (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL UNIQUE,
				is_deletable INTEGER NOT NULL DEFAULT 1
			);

			INSERT INTO folders (id, name, is_deletable) VALUES
				('inbox', 'Inbox', 0),
				('sent', 'Sent', 0),
				('draft', 'Drafts', 0),
				('trash', 'Trash', 0),
				('archive', 'Archive', 0),
				('spam', 'Spam', 0);

			CREATE TABLE emails (
				id TEXT PRIMARY KEY,
				folder_id TEXT NOT NULL,
				subject TEXT,
				sender TEXT,
				recipient TEXT,
				cc TEXT,
				bcc TEXT,
				date TEXT,
				read INTEGER DEFAULT 0,
				starred INTEGER DEFAULT 0,
				body TEXT,
				in_reply_to TEXT,
				email_references TEXT,
				thread_id TEXT,
				message_id TEXT,
				raw_headers TEXT,
				FOREIGN KEY(folder_id) REFERENCES folders(id) ON DELETE CASCADE
			);

			CREATE TABLE attachments (
				id TEXT PRIMARY KEY,
				email_id TEXT NOT NULL,
				filename TEXT NOT NULL,
				mimetype TEXT NOT NULL,
				size INTEGER NOT NULL,
				content_id TEXT,
				disposition TEXT,
				FOREIGN KEY(email_id) REFERENCES emails(id) ON DELETE CASCADE
			);

			CREATE INDEX idx_emails_thread_id ON emails(thread_id);
			CREATE INDEX idx_emails_in_reply_to ON emails(in_reply_to);
			CREATE INDEX idx_emails_folder_id ON emails(folder_id);
			CREATE INDEX idx_emails_date ON emails(date);
			CREATE INDEX idx_emails_folder_date ON emails(folder_id, date DESC);
		`,
	},
	{
		// Profile table: one row per DO instance with the employee's identity.
		// Lets the React UI fetch { email, displayName, employeeId } via
		// getProfile() without round-tripping to Clerk on every request.
		name: "2_profile_table",
		sql: `
			CREATE TABLE profile (
				id INTEGER PRIMARY KEY CHECK (id = 1),
				employee_id TEXT NOT NULL,
				email TEXT NOT NULL,
				display_name TEXT NOT NULL,
				created_at TEXT NOT NULL DEFAULT (datetime('now')),
				updated_at TEXT NOT NULL DEFAULT (datetime('now'))
			);
		`,
	},
	{
		// v1.2 Phase 12 Wave 1: cross-channel todo store.
		//
		// The Dashboard Mothership Agent extracts action items from email
		// (synchronously on createEmail()) and from Mattermost chat (via
		// the DO alarm, every 2 minutes). Both write into this table; the
		// Dashboard pane reads it via GET /api/dashboard/todos.
		//
		// Columns mirror the research spec exactly:
		//   - source_channel constrained to the five channels we plan to
		//     observe (email/chat/phone/sms/meeting). Phone/SMS/Meeting
		//     have placeholder UI in Wave 1 but no ingest yet.
		//   - urgency_score 0–100 is LLM-assigned; the ranking SQL combines
		//     it with mention/deadline boosts and recency decay at read time.
		//   - mentioned_actors is a JSON-encoded array stored as TEXT.
		//   - is_mention is an INTEGER 0/1 (SQLite has no native bool).
		//   - resolved_at NULL ⇒ active todo; non-null ⇒ resolved/dismissed.
		//
		// Indexes match the two read patterns:
		//   - idx_todos_urgency: dashboard list query
		//     (WHERE resolved_at IS NULL ORDER BY urgency_score DESC).
		//   - idx_todos_source: dedup on (source_channel, source_id) so
		//     the alarm's INSERT OR IGNORE on Mattermost re-polls actually
			//     deduplicates at the DB level — plain index alone wouldn't,
			//     since the primary key is a UUID per-insert. (Verifier fix
			//     2026-05-19.)
		name: "3_todos_table",
		sql: `
			CREATE TABLE todos (
				id TEXT PRIMARY KEY,
				employee_id TEXT NOT NULL,
				source_channel TEXT NOT NULL CHECK (source_channel IN ('email','chat','phone','sms','meeting')),
				source_id TEXT NOT NULL,
				title TEXT NOT NULL,
				preview TEXT,
				urgency_score INTEGER NOT NULL DEFAULT 50,
				deadline_at TEXT,
				mentioned_actors TEXT,
				is_mention INTEGER NOT NULL DEFAULT 0,
				created_at TEXT NOT NULL DEFAULT (datetime('now')),
				resolved_at TEXT
			);
			CREATE INDEX idx_todos_urgency ON todos(resolved_at, urgency_score DESC);
			CREATE UNIQUE INDEX idx_todos_source ON todos(source_channel, source_id);
		`,
	},
	{
		// v1.2 Phase 13 Wave 1: cross-pane notifications + push subscriptions.
		//
		// Both tables live on EmployeeMailboxDO (per-employee scoping). The
		// notifications table records a row for every push trigger (urgent
		// todo / starred email / chat mention) regardless of whether a
		// PushSubscription successfully receives it — the notification
		// drawer then reads from this table directly. The
		// push_subscriptions table holds one row per registered browser
		// endpoint; the DO iterates these on every sendPushToSubscriptions()
		// call and issues VAPID-signed POSTs.
		//
		// Indexes:
		//   - idx_notifications_employee_read: drawer query
		//     (WHERE employee_id=? AND read=0 ORDER BY created_at DESC).
		//   - idx_push_subs_employee: subscription lookup by employee.
		name: "4_notifications_push",
		sql: `
			CREATE TABLE notifications (
				id TEXT PRIMARY KEY,
				employee_id TEXT NOT NULL,
				event_type TEXT NOT NULL CHECK (event_type IN ('urgent_todo','starred_email','chat_mention')),
				title TEXT NOT NULL,
				body TEXT,
				url TEXT,
				read INTEGER NOT NULL DEFAULT 0,
				created_at TEXT NOT NULL DEFAULT (datetime('now'))
			);
			CREATE INDEX idx_notifications_employee_read ON notifications(employee_id, read, created_at DESC);

			CREATE TABLE push_subscriptions (
				endpoint TEXT PRIMARY KEY,
				employee_id TEXT NOT NULL,
				p256dh TEXT NOT NULL,
				auth TEXT NOT NULL,
				created_at TEXT NOT NULL DEFAULT (datetime('now'))
			);
			CREATE INDEX idx_push_subs_employee ON push_subscriptions(employee_id);
		`,
	},
	{
		// v1.2 Phase 13 Wave 3: first-login onboarding wizard + feature flags.
		//
		// Adds two columns to the `profile` table:
		//   - onboarded_at: NULL until the employee completes the wizard.
		//     Reading the wizard dismiss → completion gate uses this.
		//   - feature_flags: per-employee JSON-encoded overrides (TEXT).
		//     NULL means "use the global defaults from PARROT_FEATURE_FLAGS KV
		//     only". When populated it's a JSON object that overrides per-flag.
		//
		// Both columns are NULL-safe ALTERs — no DEFAULT, no UPDATE pass —
		// because every existing profile row was created BEFORE this migration
		// and therefore IS NOT onboarded under the new schema. That maps to
		// "show the wizard on next login" which is exactly what we want.
		name: "5_onboarding_flags",
		sql: `
			ALTER TABLE profile ADD COLUMN onboarded_at TEXT;
			ALTER TABLE profile ADD COLUMN feature_flags TEXT;
		`,
	},
	{
		// v1.2 Phase 11 Wave 1: per-employee personal Daily.co room.
		//
		// Adds two nullable columns to the existing `profile` table:
		//   - personal_room_name: the Daily.co room name slug (e.g.
		//     "parrot-user_abc123"). Derived from the Clerk user ID so
		//     it's deterministic and URL-safe.
		//   - personal_room_url: the fully-qualified Daily.co room URL
		//     (e.g. "https://internjobs.daily.co/parrot-user_abc123").
		//
		// Both are NULL until ensurePersonalRoom() provisions them on first
		// use. Using nullable ALTERs (no DEFAULT) matches the migration-5
		// pattern for profile columns added after initial row creation —
		// existing rows interpret NULL as "no room yet, provision on next
		// call".
		name: "6_meetings_rooms",
		sql: `
			ALTER TABLE profile ADD COLUMN personal_room_name TEXT;
			ALTER TABLE profile ADD COLUMN personal_room_url TEXT;
		`,
	},
	{
		// v1.2 Phase 11 Wave 3: add 'meeting_started' event_type for Daily.co rooms.
		//
		// SQLite does not support ALTER TABLE ... MODIFY CONSTRAINT, so we must
		// recreate the notifications table with the new CHECK constraint.
		// Migration pattern: CREATE new table → INSERT FROM old → DROP old → RENAME.
		//
		// Phase 13's reuse of 'urgent_todo' for meeting demand was a deliberate
		// temporary measure (see 13-02-SUMMARY.md). This migration supersedes it
		// by providing a dedicated type. Phase 11 updates the start-meeting handler
		// to write 'meeting_started' rows instead.
		//
		// Atomicity: the runner in applyMigrations() wraps each migration's
		// sql.exec() block in storage.transactionSync() (when storage is passed),
		// so the CREATE / INSERT / DROP / RENAME / CREATE-INDEX chain is
		// applied as a single transaction. On failure mid-chain, the original
		// `notifications` table remains intact.
		name: "7_meeting_started_event_type",
		sql: `
			CREATE TABLE notifications_new (
				id TEXT PRIMARY KEY,
				employee_id TEXT NOT NULL,
				event_type TEXT NOT NULL CHECK (event_type IN ('urgent_todo','starred_email','chat_mention','meeting_started')),
				title TEXT NOT NULL,
				body TEXT,
				url TEXT,
				read INTEGER NOT NULL DEFAULT 0,
				created_at TEXT NOT NULL DEFAULT (datetime('now'))
			);
			INSERT INTO notifications_new SELECT * FROM notifications;
			DROP TABLE notifications;
			ALTER TABLE notifications_new RENAME TO notifications;
			CREATE INDEX idx_notifications_employee_read ON notifications(employee_id, read, created_at DESC);
		`,
	},
	{
		// v1.3 Phase 19 Plan 01 (PARROT-AUTO-CLEAR): Todo auto-resolution.
		//
		// Adds a single TEXT column `resolution_source` to the existing `todos`
		// table to record HOW a todo was resolved:
		//   - 'agent' : closed by the Phase 19 cron (auto-clear.ts) after the
		//               underlying :Todo node's valid_to was set in FalkorDB
		//   - 'user'  : (future, currently NULL) closed by manual operator
		//               dismiss. The pre-Phase-19 cleanupTodosForEmail() path
		//               leaves this NULL — the UI treats NULL == 'user' so
		//               legacy rows render as "You" in the Resolved view.
		//
		// No DEFAULT — existing resolved rows (created by cleanupTodosForEmail
		// during email-delete) stay NULL, and the new auto-clear path writes
		// 'agent' explicitly. The CHECK constraint mirrors the source_channel
		// pattern from migration 3 and allows NULL.
		//
		// Migration 8 — incremented from 7, NO collision: existing migrations
		// are 1 through 7 (see entries above). DO migration runner rejects
		// duplicate names via INSERT INTO d1_migrations (name) UNIQUE constraint.
		//
		// AUTO-CLEAR-01, AUTO-CLEAR-02
		name: "8_resolution_source",
		sql: `
			ALTER TABLE todos ADD COLUMN resolution_source TEXT
				CHECK (resolution_source IN ('agent', 'user') OR resolution_source IS NULL);
		`,
	},
];
