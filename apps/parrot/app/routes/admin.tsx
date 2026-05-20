// v1.2 Phase 16 Wave 2: /admin — operator-only employee directory.
//
// Client-rendered list at /admin showing all invited employees, their
// status, and their 6 capability flags as pill badges. Each row has an
// inline "Edit" affordance that expands the row to reveal 6 checkboxes;
// submitting them PATCHes /api/admin/employees/:id/flags and refreshes
// the pills without a page reload.
//
// Why client-side (no loader): the parrot app is a Hono/Workers + React
// SPA. There is no remix-style server loader pattern here — every other
// route uses `fetch` + `useEffect` for data, so we do too (see
// dashboard.tsx, meetings.tsx for prior art).
//
// Operator gate: API endpoints are guarded by requireOperator middleware
// in workers/routes/admin-employees.ts. The page renders for any signed-in
// user but will surface 403 errors from the API as a "Not authorized"
// banner — the same pattern as admin.invite.tsx.

import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router";
import { WorkspaceShell } from "~/components/WorkspaceShell";
import { apiFetch } from "~/lib/api";

interface EmployeeRow {
	id: string;
	clerk_user_id: string;
	workspace_email: string;
	personal_email: string;
	display_name: string;
	status: "invited" | "active" | "disabled";
	created_at: string;
}

type CapabilityKey =
	| "email"
	| "chat"
	| "meetings"
	| "phone"
	| "sms"
	| "campaigns";

interface CapabilityFlags {
	email: boolean;
	chat: boolean;
	meetings: boolean;
	phone: boolean;
	sms: boolean;
	campaigns: boolean;
}

const CAPABILITY_KEYS: CapabilityKey[] = [
	"email",
	"chat",
	"meetings",
	"phone",
	"sms",
	"campaigns",
];

const CAPABILITY_LABELS: Record<CapabilityKey, string> = {
	email: "Email",
	chat: "Chat",
	meetings: "Meetings",
	phone: "Phone",
	sms: "SMS",
	campaigns: "Campaigns",
};

interface ListResponse {
	employees: EmployeeRow[];
}

interface FlagsResponse {
	feature_flags: Partial<CapabilityFlags>;
}

interface ApiError {
	error: string;
	[k: string]: unknown;
}

const DEFAULT_FLAGS: CapabilityFlags = {
	email: true,
	chat: true,
	meetings: true,
	phone: true,
	sms: true,
	campaigns: true,
};

async function fetchEmployees(): Promise<EmployeeRow[]> {
	const res = await apiFetch("/api/admin/employees");
	const body = (await res.json().catch(() => null)) as
		| ListResponse
		| ApiError
		| null;
	if (!res.ok) {
		throw new Error(
			(body as ApiError | null)?.error || `List failed (${res.status})`,
		);
	}
	return (body as ListResponse).employees ?? [];
}

async function fetchFlags(employeeId: string): Promise<CapabilityFlags> {
	const res = await apiFetch(
		`/api/admin/employees/${encodeURIComponent(employeeId)}/flags`,
	);
	const body = (await res.json().catch(() => null)) as
		| FlagsResponse
		| ApiError
		| null;
	if (!res.ok) {
		throw new Error(
			(body as ApiError | null)?.error || `Flags fetch failed (${res.status})`,
		);
	}
	// Merge with defaults so a partial KV value still produces a complete
	// CapabilityFlags shape — same contract the backend exposes.
	return {
		...DEFAULT_FLAGS,
		...((body as FlagsResponse).feature_flags ?? {}),
	};
}

async function patchFlags(
	employeeId: string,
	flags: CapabilityFlags,
): Promise<CapabilityFlags> {
	const res = await apiFetch(
		`/api/admin/employees/${encodeURIComponent(employeeId)}/flags`,
		{
			method: "PATCH",
			body: JSON.stringify({ featureFlags: flags }),
		},
	);
	const body = (await res.json().catch(() => null)) as
		| { ok: boolean; feature_flags: CapabilityFlags }
		| ApiError
		| null;
	if (!res.ok) {
		throw new Error(
			(body as ApiError | null)?.error || `Flags PATCH failed (${res.status})`,
		);
	}
	return {
		...DEFAULT_FLAGS,
		...((body as { feature_flags: CapabilityFlags }).feature_flags ?? {}),
	};
}

async function disableEmployee(employeeId: string): Promise<void> {
	const res = await apiFetch(
		`/api/admin/employees/${encodeURIComponent(employeeId)}`,
		{ method: "DELETE" },
	);
	const body = (await res.json().catch(() => null)) as ApiError | null;
	if (!res.ok) {
		throw new Error(body?.error || `Disable failed (${res.status})`);
	}
}

export default function AdminRoute() {
	const [employees, setEmployees] = useState<EmployeeRow[]>([]);
	const [flags, setFlags] = useState<Record<string, CapabilityFlags>>({});
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editDraft, setEditDraft] = useState<CapabilityFlags | null>(null);
	const [busy, setBusy] = useState<Record<string, boolean>>({});
	const [pageError, setPageError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);

	// Initial load of the employee list.
	const loadEmployees = useCallback(async () => {
		setLoading(true);
		setPageError(null);
		try {
			const rows = await fetchEmployees();
			setEmployees(rows);
			// Lazy-load flags per row in parallel. Errors per row are swallowed
			// into the default-all-on shape so the table still renders.
			const flagEntries = await Promise.all(
				rows.map(async (r) => {
					try {
						const f = await fetchFlags(r.id);
						return [r.id, f] as const;
					} catch {
						return [r.id, DEFAULT_FLAGS] as const;
					}
				}),
			);
			const next: Record<string, CapabilityFlags> = {};
			for (const [id, f] of flagEntries) next[id] = f;
			setFlags(next);
		} catch (e) {
			setPageError((e as Error).message);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void loadEmployees();
	}, [loadEmployees]);

	function startEdit(row: EmployeeRow) {
		setEditingId(row.id);
		setEditDraft(flags[row.id] ?? { ...DEFAULT_FLAGS });
	}

	function cancelEdit() {
		setEditingId(null);
		setEditDraft(null);
	}

	function toggleDraft(key: CapabilityKey) {
		setEditDraft((prev) => (prev ? { ...prev, [key]: !prev[key] } : prev));
	}

	async function submitCapabilityEdit(row: EmployeeRow) {
		if (!editDraft) return;
		setBusy((b) => ({ ...b, [row.id]: true }));
		try {
			const updated = await patchFlags(row.id, editDraft);
			setFlags((prev) => ({ ...prev, [row.id]: updated }));
			setEditingId(null);
			setEditDraft(null);
		} catch (e) {
			setPageError((e as Error).message);
		} finally {
			setBusy((b) => ({ ...b, [row.id]: false }));
		}
	}

	async function onDisable(row: EmployeeRow) {
		const confirmed = window.confirm(
			`Disable ${row.display_name} (${row.workspace_email})? They will lose workspace access.`,
		);
		if (!confirmed) return;
		setBusy((b) => ({ ...b, [row.id]: true }));
		try {
			await disableEmployee(row.id);
			await loadEmployees();
		} catch (e) {
			setPageError((e as Error).message);
		} finally {
			setBusy((b) => ({ ...b, [row.id]: false }));
		}
	}

	return (
		<WorkspaceShell title="Admin">
			<div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
				<div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
					<div className="min-w-0">
						<h2 className="text-lg font-semibold text-slate-900">
							Employee directory
						</h2>
						<p className="mt-1 text-sm text-slate-600">
							Everyone who's been invited to the workspace. Toggle
							capabilities per employee to control which workspace surfaces
							they can use.
						</p>
					</div>
					<Link
						to="/admin/invite"
						className="inline-flex w-full justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white no-underline hover:bg-slate-800 sm:w-auto"
					>
						Add employee
					</Link>
				</div>

				{pageError && (
					<div className="mb-4 rounded-md bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-900">
						{pageError}
					</div>
				)}

				<div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
					{loading ? (
						<div className="p-6 text-sm text-slate-500">Loading…</div>
					) : employees.length === 0 ? (
						<div className="p-6 text-sm text-slate-500">
							No employees yet.{" "}
							<Link
								to="/admin/invite"
								className="text-slate-900 font-medium hover:underline"
							>
								Invite the first one →
							</Link>
						</div>
					) : (
						<div className="overflow-x-auto">
							<table className="w-full min-w-[760px] text-sm">
								<thead className="border-b border-slate-200 bg-slate-50">
									<tr className="text-left text-xs uppercase tracking-wide text-slate-500">
										<th className="px-3 py-3 sm:px-4">Display name</th>
										<th className="px-3 py-3 sm:px-4">Workspace email</th>
										<th className="px-3 py-3 sm:px-4">Status</th>
										<th className="px-3 py-3 sm:px-4">Capabilities</th>
										<th className="px-3 py-3 text-right sm:px-4">Actions</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-100">
									{employees.map((row) => {
									const rowFlags = flags[row.id] ?? DEFAULT_FLAGS;
									const isEditing = editingId === row.id;
									const isDisabled = row.status === "disabled";
									const isBusy = !!busy[row.id];
									return (
										<>
											<tr
												key={row.id}
												className={isDisabled ? "text-slate-400" : ""}
											>
												<td className="px-3 py-3 font-medium text-slate-900 sm:px-4">
													{isDisabled ? (
														<span className="text-slate-400">
															{row.display_name}
														</span>
													) : (
														row.display_name
													)}
												</td>
												<td className="px-3 py-3 font-mono text-xs text-slate-600 sm:px-4">
													{row.workspace_email}
												</td>
												<td className="px-3 py-3 sm:px-4">
													<StatusBadge status={row.status} />
												</td>
												<td className="px-3 py-3 sm:px-4">
													<CapabilityPills flags={rowFlags} />
												</td>
												<td className="px-3 py-3 text-right sm:px-4">
													<div className="flex flex-wrap justify-end gap-2">
														<button
															type="button"
															onClick={() => startEdit(row)}
															disabled={isBusy || isDisabled || isEditing}
															className="rounded-md border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
														>
															Edit
														</button>
														{!isDisabled && (
															<button
																type="button"
																onClick={() => onDisable(row)}
																disabled={isBusy}
																className="rounded-md border border-rose-200 bg-white px-3 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
															>
																Disable
															</button>
														)}
													</div>
												</td>
											</tr>
											{isEditing && editDraft && (
												<tr key={`${row.id}-edit`}>
													<td
														colSpan={5}
														className="border-t border-slate-100 bg-slate-50 px-3 py-4 sm:px-4"
													>
														<div>
															<p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">
																Capabilities for {row.display_name}
															</p>
															<div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
																{CAPABILITY_KEYS.map((key) => (
																	<label
																		key={key}
																		className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm cursor-pointer hover:bg-slate-50"
																	>
																		<input
																			type="checkbox"
																			checked={editDraft[key]}
																			onChange={() => toggleDraft(key)}
																			className="h-4 w-4 rounded border-slate-300"
																		/>
																		<span className="text-slate-700">
																			{CAPABILITY_LABELS[key]}
																		</span>
																	</label>
																))}
															</div>
															<div className="mt-4 flex flex-col gap-2 sm:flex-row">
																<button
																	type="button"
																	onClick={() => submitCapabilityEdit(row)}
																	disabled={isBusy}
																	className="rounded-md bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 sm:py-1.5"
																>
																	{isBusy ? "Saving…" : "Save capabilities"}
																</button>
																<button
																	type="button"
																	onClick={cancelEdit}
																	disabled={isBusy}
																	className="rounded-md border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 sm:py-1.5"
																>
																	Cancel
																</button>
															</div>
														</div>
													</td>
												</tr>
											)}
										</>
									);
									})}
								</tbody>
							</table>
						</div>
					)}
				</div>
			</div>
		</WorkspaceShell>
	);
}

// — Subcomponents ————————————————————————————————————————————

function StatusBadge({ status }: { status: EmployeeRow["status"] }) {
	const style =
		status === "active"
			? "bg-emerald-100 text-emerald-800"
			: status === "invited"
				? "bg-amber-100 text-amber-800"
				: "bg-slate-100 text-slate-500";
	return (
		<span
			className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${style}`}
		>
			{status}
		</span>
	);
}

function CapabilityPills({ flags }: { flags: CapabilityFlags }) {
	return (
		<div className="flex flex-wrap gap-1">
			{CAPABILITY_KEYS.map((key) => {
				const active = flags[key];
				return (
					<span
						key={key}
						className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
							active
								? "bg-emerald-100 text-emerald-800"
								: "bg-slate-100 text-slate-500"
						}`}
					>
						{CAPABILITY_LABELS[key].toLowerCase()}
					</span>
				);
			})}
		</div>
	);
}
