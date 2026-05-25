// apps/startup/workers/tools/discover-actions.ts
// v1.4 Phase 28 STARTUP-MCP-04 — discover_actions() tool handler.
//
// Returns the 5 v1 action schemas in the Stainless `list_api_endpoints` shape:
//   { name, description, input_schema: { type, properties, required }, examples? }
//
// `input_schema` uses snake_case (Stainless OpenAPI convention — matches
// training-data distribution for LLM-driven tool selection; do NOT switch
// to camelCase). This is a pure function: no DB access, no auth context.

export interface ActionSchema {
	name: string;
	description: string;
	input_schema: {
		type: "object";
		properties: Record<string, unknown>;
		required: string[];
	};
	examples?: Array<Record<string, unknown>>;
}

export function handleDiscoverActions(): ActionSchema[] {
	return [
		{
			name: "post_role",
			description:
				"Create a new internship role for your startup. Semantically indexed for candidate matching. Call this before search('candidates') so candidates are matched to your specific role.",
			input_schema: {
				type: "object",
				properties: {
					title: {
						type: "string",
						description: "Role title e.g. 'Frontend Engineering Intern'",
					},
					description: {
						type: "string",
						description:
							"Full role description — what the intern will work on",
					},
					requirements: {
						type: "string",
						description: "Required skills and qualifications (optional)",
					},
					location: {
						type: "string",
						description: "Location or 'Remote' (optional)",
					},
					comp_range: {
						type: "string",
						description: "Compensation range e.g. '$20–25/hr' (optional)",
					},
				},
				required: ["title", "description"],
			},
			examples: [
				{
					title: "Frontend Engineering Intern",
					description:
						"Build core product UI using React and TypeScript",
					requirements: "React, TypeScript, 1+ year experience",
					location: "San Francisco or Remote",
				},
			],
		},
		{
			name: "reply_to_candidate",
			description:
				"Send a reply to a candidate in an existing conversation thread. The message routes via the same channel the candidate used. Channel-agnostic: SMS, email, and MCP-initiated conversations all use the same thread.",
			input_schema: {
				type: "object",
				properties: {
					thread_id: {
						type: "string",
						format: "uuid",
						description:
							"Thread ID from search('threads') or search('candidates')",
					},
					message: {
						type: "string",
						description: "Your reply message (max 2000 chars)",
					},
				},
				required: ["thread_id", "message"],
			},
		},
		{
			name: "update_role",
			description:
				"Update an existing role's fields (title, description, status, location, compensation).",
			input_schema: {
				type: "object",
				properties: {
					role_id: {
						type: "string",
						format: "uuid",
						description: "Role ID from search('roles')",
					},
					patch: {
						type: "object",
						description: "Fields to update (all optional)",
						properties: {
							title: { type: "string" },
							description: { type: "string" },
							status: {
								type: "string",
								enum: ["active", "paused", "filled"],
							},
							location: { type: "string" },
							comp_range: { type: "string" },
						},
					},
				},
				required: ["role_id", "patch"],
			},
		},
		{
			name: "archive_role",
			description:
				"Archive a role (sets status to 'filled'). Candidates stop being matched to this role. Use when a role is filled or cancelled.",
			input_schema: {
				type: "object",
				properties: {
					role_id: {
						type: "string",
						format: "uuid",
						description: "Role ID to archive",
					},
				},
				required: ["role_id"],
			},
		},
		{
			name: "mark_candidate",
			description:
				"Mark your interest level on a candidate thread. Used to track pipeline stage.",
			input_schema: {
				type: "object",
				properties: {
					thread_id: {
						type: "string",
						format: "uuid",
						description:
							"Thread ID from search('candidates') or search('threads')",
					},
					mark: {
						type: "string",
						enum: [
							"interested",
							"not_interested",
							"shortlisted",
							"rejected",
						],
						description: "Your interest level",
					},
				},
				required: ["thread_id", "mark"],
			},
		},
	];
}
