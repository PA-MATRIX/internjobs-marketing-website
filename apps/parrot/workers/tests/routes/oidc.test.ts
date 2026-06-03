// WSTEST-02: oidc route smoke.
// GET /oidc/.well-known/openid-configuration is public — must return 200 JSON.
import { describe, it, expect } from "vitest";
import { app } from "../../index";
import { minimalEnv, mockCtx } from "../helpers";

describe("oidc route smoke", () => {
	it("GET /oidc/.well-known/openid-configuration returns 200", async () => {
		const req = new Request(
			"https://parrot.example.com/oidc/.well-known/openid-configuration",
		);
		const res = await app.fetch(req, minimalEnv as any, mockCtx);
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		// Must include issuer and authorization_endpoint per OIDC spec.
		expect(body).toHaveProperty("issuer");
		expect(body).toHaveProperty("authorization_endpoint");
		expect(body).toHaveProperty("token_endpoint");
	});
});
