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
];
