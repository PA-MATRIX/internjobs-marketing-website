// Phase 31 Wave 4 (plan 31-05): real-time WS proxy guards + offline email.
//
// Covers (node-runnable parts only — the happy-path WebSocketPair bridge needs
// the workerd runtime and is verified via build + live UAT in 31-06):
//   - handleChatWebSocket: 426 when the request is not a WebSocket upgrade
//   - handleChatWebSocket: 503 chat_not_provisioned when the employee has no PAT
//   - sendOfflineChatNotification: returns {ok:false} when EMAIL binding missing
//   - sendOfflineChatNotification: sends with singular/plural subject + workspace link

import { describe, it, expect, vi, afterEach } from "vitest";
import { handleChatWebSocket } from "../../lib/mm-ws-proxy";
import { sendOfflineChatNotification } from "../../lib/email-sender";
import type { Employee, Env } from "../../types";

afterEach(() => vi.restoreAllMocks());

const employee = {
	employeeId: "user_abc",
	email: "alice@internjobs.ai",
	displayName: "Alice",
} as Employee;

function envWithToken(tokenRow: { mmUserId: string; token: string } | null): Env {
	const stub = { getEmployeeToken: vi.fn().mockResolvedValue(tokenRow) };
	return {
		MATTERMOST_URL: "https://mm.example.com",
		WORKSPACE: {
			idFromName: () => "id",
			get: () => stub,
		},
	} as unknown as Env;
}

describe("handleChatWebSocket", () => {
	it("returns 426 when the request is not a WebSocket upgrade", async () => {
		const req = new Request("https://parrot.example.com/api/chat/ws");
		const res = await handleChatWebSocket(
			req,
			envWithToken({ mmUserId: "u1", token: "pat_x" }),
			employee,
		);
		expect(res.status).toBe(426);
	});

	it("returns 503 chat_not_provisioned when the employee has no stored PAT", async () => {
		const req = new Request("https://parrot.example.com/api/chat/ws", {
			headers: { upgrade: "websocket" },
		});
		const res = await handleChatWebSocket(req, envWithToken(null), employee);
		expect(res.status).toBe(503);
		const body = (await res.json()) as { error: string };
		expect(body.error).toBe("chat_not_provisioned");
	});
});

describe("sendOfflineChatNotification", () => {
	it("returns {ok:false} and does not throw when EMAIL binding is missing", async () => {
		const result = await sendOfflineChatNotification({}, "alice@internjobs.ai", 3);
		expect(result.ok).toBe(false);
	});

	it("sends a singular-subject email for a single mention", async () => {
		const send = vi.fn().mockResolvedValue({ messageId: "m1" });
		const result = await sendOfflineChatNotification(
			{ EMAIL: { send } as unknown as SendEmail },
			"alice@internjobs.ai",
			1,
		);
		expect(result.ok).toBe(true);
		const sent = send.mock.calls[0][0] as {
			to: string;
			subject: string;
			text: string;
			html: string;
		};
		expect(sent.to).toBe("alice@internjobs.ai");
		expect(sent.subject).toBe(
			"You have 1 unread mention in your workspace chat",
		);
		expect(sent.text).toContain("workspace.internjobs.ai/chat");
	});

	it("sends a plural-subject email for multiple mentions", async () => {
		const send = vi.fn().mockResolvedValue({ messageId: "m2" });
		await sendOfflineChatNotification(
			{ EMAIL: { send } as unknown as SendEmail },
			"bob@internjobs.ai",
			4,
		);
		const sent = send.mock.calls[0][0] as { subject: string };
		expect(sent.subject).toBe(
			"You have 4 unread mentions in your workspace chat",
		);
	});

	it("returns {ok:false} (fail-soft) when the EMAIL send throws", async () => {
		const send = vi.fn().mockRejectedValue(new Error("smtp down"));
		const result = await sendOfflineChatNotification(
			{ EMAIL: { send } as unknown as SendEmail },
			"alice@internjobs.ai",
			2,
		);
		expect(result.ok).toBe(false);
	});
});
