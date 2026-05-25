// apps/marketing/src/components/StartupAccessSection.tsx
// v1.4 Phase 28 Plan 28-05 — STARTUP-MARKETING-01 + STARTUP-MARKETING-02.
//
// Two sub-components consumed by App.tsx's StartupPage:
//   1. RequestAccessForm  — Request Access CTA. POSTs to
//      https://mcp.internjobs.ai/api/request-access (CORS-allowed from
//      internjobs.ai). On success, swaps to a confirmation line.
//   2. ChannelsGrid       — "how we work with you" section. Primary tier
//      (Claude/ChatGPT, Cursor/Cline, Voice, SMS, Email — one-line subhead each)
//      + coming-soon tier (Slack, Discord, Teams).
//
// Brand voice: lowercase, blunt, no corporate-speak (BRAND-V1.md).
// Accent: cobalt — this is the /startups page accent (BRAND-LAYOUT-02).
// No hex literals — CSS vars only (BRAND-LAYOUT-05).
//
// Note: this is a transitional surface. Phase 28.5 (startups.internjobs.ai)
// will replace the form with a clerk-backed sign-up flow. Don't over-engineer.

import { useState } from "react";

const REQUEST_ACCESS_ENDPOINT = "https://mcp.internjobs.ai/api/request-access";

type SubmitState = "idle" | "loading" | "done" | "error";

export function RequestAccessForm() {
	const [form, setForm] = useState({
		name: "",
		email: "",
		phone: "",
		what_hiring_for: "",
	});
	const [state, setState] = useState<SubmitState>("idle");

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		setState("loading");
		try {
			const res = await fetch(REQUEST_ACCESS_ENDPOINT, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(form),
			});
			setState(res.ok ? "done" : "error");
		} catch {
			setState("error");
		}
	}

	if (state === "done") {
		return (
			<div
				style={{
					padding: "1.5rem",
					borderRadius: "var(--radius-card)",
					background: "var(--lavender)",
					border: "2px solid var(--cobalt)",
					maxWidth: "420px",
				}}
			>
				<p
					style={{
						color: "var(--ink)",
						fontFamily: "Inter, sans-serif",
						fontSize: "1.05rem",
						fontWeight: 700,
						margin: 0,
					}}
				>
					got it
					<span className="accent-dot" style={{ color: "var(--cobalt)" }}>
						.
					</span>{" "}
					ridhi will text you shortly.
				</p>
			</div>
		);
	}

	const inputStyle: React.CSSProperties = {
		padding: "0.75rem 1rem",
		borderRadius: "var(--radius-card)",
		border: "2px solid var(--cobalt)",
		fontFamily: "Inter, sans-serif",
		fontSize: "1rem",
		color: "var(--ink)",
		background: "var(--lavender)",
		outline: "none",
	};

	return (
		<form
			onSubmit={submit}
			style={{
				display: "flex",
				flexDirection: "column",
				gap: "0.75rem",
				maxWidth: "420px",
			}}
		>
			<input
				type="text"
				placeholder="your name"
				required
				value={form.name}
				onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
				style={inputStyle}
				autoComplete="name"
			/>
			<input
				type="email"
				placeholder="work email"
				required
				value={form.email}
				onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
				style={inputStyle}
				autoComplete="email"
			/>
			<input
				type="tel"
				placeholder="phone (we'll text you the install)"
				value={form.phone}
				onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
				style={inputStyle}
				autoComplete="tel"
			/>
			<input
				type="text"
				placeholder="what are you hiring for?"
				value={form.what_hiring_for}
				onChange={(e) =>
					setForm((f) => ({ ...f, what_hiring_for: e.target.value }))
				}
				style={inputStyle}
			/>
			<button
				type="submit"
				disabled={state === "loading"}
				style={{
					padding: "0.85rem 2rem",
					borderRadius: "var(--radius-pill)",
					background: "var(--cobalt)",
					color: "var(--lavender)",
					fontFamily: "Inter, sans-serif",
					fontWeight: 700,
					fontSize: "1rem",
					border: "none",
					cursor: state === "loading" ? "wait" : "pointer",
					letterSpacing: "-0.02em",
					opacity: state === "loading" ? 0.7 : 1,
					transition: "opacity 0.2s",
				}}
			>
				{state === "loading" ? "sending..." : "request access →"}
			</button>
			{state === "error" ? (
				<p
					style={{
						color: "var(--tangerine)",
						fontSize: "0.9rem",
						fontFamily: "Inter, sans-serif",
						margin: 0,
					}}
				>
					something went wrong. email raj@internjobs.ai directly.
				</p>
			) : null}
		</form>
	);
}

type PrimaryChannel = {
	name: string;
	how: string;
	tag?: string;
};

const primaryChannels: PrimaryChannel[] = [
	{
		name: "claude / chatgpt",
		how: "connect via mcp — post roles, search candidates, reply to threads from your ai client.",
	},
	{
		name: "cursor / cline",
		how: "same mcp install. works in any cursor or cline project. one command.",
	},
	{
		name: "voice",
		how: "call our number. ai greets you, collects your role in 30 seconds, texts you the install link.",
		tag: "coming v29",
	},
	{
		name: "sms",
		how: "text us a natural-language request. we map it to the right action and reply.",
		tag: "coming v29",
	},
	{
		name: "email",
		how: "reply to any candidate thread via email. all channels share the same conversation.",
		tag: "coming v28.5",
	},
];

const comingSoonChannels: string[] = ["slack", "discord", "microsoft teams"];

export function ChannelsGrid() {
	return (
		<section
			id="startup-channels"
			style={{
				padding: "4rem 1.25rem",
				background: "var(--lavender)",
			}}
		>
			<div style={{ maxWidth: "76rem", margin: "0 auto" }}>
				<p
					style={{
						fontSize: "11px",
						fontWeight: 600,
						letterSpacing: "0.1em",
						textTransform: "uppercase",
						color: "var(--ink)",
						opacity: 0.6,
						marginBottom: "0.75rem",
					}}
				>
					HOW WE WORK WITH YOU
				</p>
				<h2
					style={{
						fontFamily: "Inter, sans-serif",
						fontWeight: 800,
						fontSize: "clamp(1.75rem, 4.5vw, 3rem)",
						color: "var(--ink)",
						letterSpacing: "-0.025em",
						margin: "0 0 1rem 0",
						lineHeight: 1.05,
					}}
				>
					talk to us where you already work
					<span className="accent-dot" style={{ color: "var(--cobalt)" }}>
						.
					</span>
				</h2>
				<p
					style={{
						fontFamily: "Inter, sans-serif",
						color: "var(--ink)",
						opacity: 0.7,
						fontSize: "1.05rem",
						lineHeight: 1.5,
						maxWidth: "44rem",
						margin: "0 0 2.5rem 0",
					}}
				>
					no forced platform. one core; many ingress channels. mcp is live;
					voice / sms / email land next.
				</p>

				{/* Primary tier */}
				<div
					style={{
						display: "grid",
						gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
						gap: "1.25rem",
						marginBottom: "2.5rem",
					}}
				>
					{primaryChannels.map(({ name, how, tag }) => (
						<div
							key={name}
							style={{
								padding: "1.5rem",
								borderRadius: "var(--radius-card)",
								background: "var(--cream)",
								border: "2px solid var(--cobalt)",
							}}
						>
							<div
								style={{
									display: "flex",
									justifyContent: "space-between",
									alignItems: "baseline",
									gap: "0.5rem",
									marginBottom: "0.6rem",
								}}
							>
								<p
									style={{
										fontFamily: "Inter, sans-serif",
										fontWeight: 700,
										color: "var(--cobalt)",
										fontSize: "1rem",
										margin: 0,
										letterSpacing: "-0.01em",
									}}
								>
									{name}
								</p>
								{tag ? (
									<span
										style={{
											fontFamily: "Inter, sans-serif",
											fontSize: "0.7rem",
											fontWeight: 700,
											color: "var(--cobalt)",
											background: "var(--lavender)",
											padding: "0.15rem 0.5rem",
											borderRadius: "var(--radius-pill)",
											letterSpacing: "0.02em",
											whiteSpace: "nowrap",
										}}
									>
										{tag}
									</span>
								) : null}
							</div>
							<p
								style={{
									fontFamily: "Inter, sans-serif",
									color: "var(--ink)",
									fontSize: "0.92rem",
									lineHeight: 1.5,
									margin: 0,
								}}
							>
								{how}
							</p>
						</div>
					))}
				</div>

				{/* Coming-soon tier */}
				<div>
					<p
						style={{
							fontSize: "11px",
							fontWeight: 600,
							letterSpacing: "0.1em",
							textTransform: "uppercase",
							color: "var(--ink)",
							opacity: 0.5,
							marginBottom: "0.75rem",
						}}
					>
						COMING IN V1.5
					</p>
					<div
						style={{
							display: "flex",
							gap: "0.6rem",
							flexWrap: "wrap",
						}}
					>
						{comingSoonChannels.map((ch) => (
							<span
								key={ch}
								style={{
									padding: "0.4rem 1rem",
									borderRadius: "var(--radius-pill)",
									border: "1.5px solid var(--ink)",
									color: "var(--ink)",
									fontFamily: "Inter, sans-serif",
									fontSize: "0.85rem",
									opacity: 0.5,
									fontWeight: 600,
								}}
							>
								{ch}{" "}
								<span style={{ fontSize: "0.72rem", opacity: 0.8 }}>
									coming soon
								</span>
							</span>
						))}
					</div>
				</div>
			</div>
		</section>
	);
}
