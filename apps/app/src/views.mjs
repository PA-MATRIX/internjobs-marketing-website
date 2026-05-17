import QRCode from "qrcode";
import { escapeHtml } from "./http.mjs";
import { getMissingProviderConfig } from "./config.mjs";
import { getSignInUrl, getStartupSignInUrl } from "./auth.mjs";

export function renderLayout({ title, body, config, auth }) {
  const missing = getMissingProviderConfig(config);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)} | InternJobs.ai</title>
    <style>${styles()}</style>
  </head>
  <body>
    <header class="topbar">
      <a class="brand" href="/waitlist"><span class="logo">∞</span><strong>InternJobs.ai</strong></a>
      <nav>
        <a href="/waitlist">Join</a>
        <a href="/onboarding">Onboarding</a>
        <a href="/pairing">Pairing</a>
        <a href="/profile">Profile</a>
      </nav>
    </header>
    ${missing.length ? `<div class="config-banner">Configuration pending: ${missing.map(escapeHtml).join(", ")}</div>` : ""}
    <main>${body}</main>
    <footer>
      <span>InternJobs.ai</span>
      <span>${auth ? `Signed in as ${escapeHtml(auth.name || auth.email || auth.clerkUserId)}` : "LinkedIn-first waitlist"}</span>
    </footer>
  </body>
</html>`;
}

export function renderWaitlist(config) {
  const signInUrl = getSignInUrl(config);

  return `
    <section class="hero-grid">
      <div>
        <p class="eyebrow">LinkedIn-only early access</p>
        <h1>Start with LinkedIn. Then just text.</h1>
        <p class="lede">InternJobs.ai uses your LinkedIn basics to start your waitlist profile, then helps you connect the messaging channel where you want internship texts.</p>
        <div class="actions">
          <a class="button primary" href="${escapeHtml(signInUrl)}">Continue with LinkedIn</a>
          ${config.enableDevAuth ? '<a class="button secondary" href="/dev/sign-in">Use dev sign-in</a>' : ""}
        </div>
        <p class="fine" id="configuration-needed">Student early access starts with LinkedIn only.</p>
      </div>
      <div class="phone-card">
        <div class="thread">
          <p class="agent">Hey Jordan, found something that actually fits.</p>
          <p class="student">Okay wait this looks good.</p>
          <p class="agent">Start with LinkedIn, then connect text. No giant profile.</p>
        </div>
      </div>
    </section>`;
}

export function renderOnboarding(student) {
  return `
    <section class="panel-grid">
      <div class="panel dark">
        <p class="eyebrow">You're in</p>
        <h1>Now connect the channel you actually check.</h1>
        <p class="lede">InternJobs.ai has your waitlist profile started. Next, pair your phone or messaging channel so the first text can reach you.</p>
        <a class="button light" href="/pairing">Connect messages</a>
      </div>
      <div class="panel">
        <p class="eyebrow">Profile started</p>
        <h2>${escapeHtml(student.name || "LinkedIn student")}</h2>
        <dl class="details">
          <div><dt>Status</dt><dd>${escapeHtml(student.status)}</dd></div>
          <div><dt>Email</dt><dd>${escapeHtml(student.email || "Not provided")}</dd></div>
          <div><dt>LinkedIn</dt><dd>${student.linkedinProfileUrl ? `<a href="${escapeHtml(student.linkedinProfileUrl)}">${escapeHtml(student.linkedinProfileUrl)}</a>` : "Authorized fields pending"}</dd></div>
        </dl>
        <a class="button secondary" href="/profile">Review profile context</a>
      </div>
    </section>`;
}

export async function renderPairing({ student, pairing, config }) {
  const number = config.photon.fromNumber || "+10000000000";
  const body = `Hey internjobs.ai! My verification code is ${pairing.code}. What's next?`;
  const smsUri = `sms:${encodeURIComponent(number)}?&body=${encodeURIComponent(body)}`;
  const qrDataUrl = await QRCode.toDataURL(smsUri, { margin: 1, width: 220, color: { dark: "#111111", light: "#ffffff" } });

  return `
    <section class="pair-grid">
      <div class="panel">
        <p class="eyebrow">Step 2</p>
        <h1>Scan it. Send the text.</h1>
        <p class="lede">Scan this with your phone. It opens a message to InternJobs.ai with your unique code already filled in.</p>
        <div class="qr-wrap"><img src="${qrDataUrl}" alt="QR code for pairing InternJobs.ai messages" /></div>
      </div>
      <div class="panel dark">
        <p class="eyebrow">Pairing code</p>
        <div class="pair-code">${escapeHtml(pairing.code)}</div>
        <p class="lede">Your phone will text <strong>${escapeHtml(config.photon.fromNumber || "the InternJobs.ai number once configured")}</strong>.</p>
        <div class="message-preview">${escapeHtml(body)}</div>
        <p class="fine">Expires ${new Date(pairing.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p>
        <form method="post" action="/pairing/regenerate"><button class="button light" type="submit">Regenerate code</button></form>
        <p class="fine">Current channel status: ${escapeHtml(student.status)}</p>
      </div>
    </section>`;
}

export function renderPairingConfirmed(student) {
  return `
    <section class="panel dark narrow">
      <p class="eyebrow">Messages connected</p>
      <h1>${escapeHtml(firstName(student.name) || "You")}, you're in.</h1>
      <p class="lede">InternJobs.ai has your LinkedIn profile started and your phone connected. Future replies from this number stay attached to your waitlist thread.</p>
      <a class="button light" href="/profile">Review profile context</a>
    </section>`;
}

export function renderProfile({ student, context }) {
  return `
    <section class="panel-grid">
      <div>
        <p class="eyebrow">Profile context</p>
        <h1>Tell it what you're into and what you've built.</h1>
        <p class="lede">This is the context InternJobs.ai uses to explain why a role might fit. Keep it short and normal.</p>
      </div>
      <form class="panel form" method="post" action="/profile">
        <label>Interests <span>comma separated</span><input name="interests" value="${escapeHtml((context.interests || []).join(", "))}" placeholder="AI tools, growth, design engineering" /></label>
        <label>Projects<textarea name="projects" rows="5" placeholder="Newsletter, student app, Discord community...">${escapeHtml(context.projects || "")}</textarea></label>
        <label>Preferred work<input name="preferredWork" value="${escapeHtml(context.preferredWork || "")}" placeholder="growth, community, product, engineering" /></label>
        <label>Notes<textarea name="notes" rows="4" placeholder="Anything you want the agent to remember">${escapeHtml(context.notes || "")}</textarea></label>
        <button class="button primary" type="submit">Save profile context</button>
        <p class="fine">Signed in as ${escapeHtml(student.name || student.email || student.clerkUserId)}</p>
      </form>
    </section>`;
}

export function renderSavedProfile() {
  return `
    <section class="panel dark narrow">
      <p class="eyebrow">Saved</p>
      <h1>Profile context updated.</h1>
      <p class="lede">InternJobs.ai will use this to make internship texts feel more relevant and less random.</p>
      <a class="button light" href="/pairing">Continue to pairing</a>
    </section>`;
}

// ─── v1.2 Phase 09 — Standout-style onboarding (QR + sms deep-link) ─────────
//
// renderOnboardingQR is the desktop landing rendered after Clerk LinkedIn
// OAuth + Proxycurl enrichment. The QR encodes an sms:// URI that, when
// scanned by an iPhone camera, prompts the user to open Messages.app
// prefilled with the agent's number + the pairing code as the body. The
// student taps send; the Mac bridge picks up the iMessage and POSTs to
// /webhooks/mac-bridge, which calls claimPairingCode and binds the phone.
//
// renderOnboardingMobile is the mobile-UA variant — no QR (the phone IS
// the QR-scanning device), just a big button whose href IS the sms:// URI.
// On iOS this opens Messages.app prefilled.
//
// Both pages poll /onboard/status every 3s and redirect to /onboard/success
// once paired. The polling JS is inlined here (no separate static asset)
// so the views are zero-dependency.

export async function renderOnboardingQR({ pairingCode, smsUri, agentNumber }) {
  const qrDataUrl = await QRCode.toDataURL(smsUri, {
    margin: 1,
    width: 260,
    color: { dark: "#111111", light: "#ffffff" },
  });
  return `
    <section class="pair-grid">
      <div class="panel">
        <p class="eyebrow">Step 2 of 2</p>
        <h1>Scan it. Send the text.</h1>
        <p class="lede">Scan with your iPhone camera. It opens Messages with the right number + code already filled in. Tap send.</p>
        <div class="qr-wrap"><img src="${qrDataUrl}" alt="QR code for pairing InternJobs.ai messages" /></div>
        <p class="fine">We've already pulled your LinkedIn — your first agent message will be contextual.</p>
      </div>
      <div class="panel dark">
        <p class="eyebrow">Pairing code</p>
        <div class="pair-code">${escapeHtml(pairingCode)}</div>
        <p class="lede">Or text <strong>${escapeHtml(pairingCode)}</strong> to <strong>${escapeHtml(agentNumber)}</strong> from your phone.</p>
        <button class="button light" type="button" id="copy-pair-code" data-code="${escapeHtml(pairingCode)}">Copy code</button>
        <p class="fine" id="pair-status">Waiting for your text…</p>
      </div>
    </section>
    <script>
      (function () {
        var btn = document.getElementById('copy-pair-code');
        if (btn) {
          btn.addEventListener('click', function () {
            var code = btn.getAttribute('data-code') || '';
            if (navigator.clipboard && code) {
              navigator.clipboard.writeText(code).then(function () {
                btn.textContent = 'Copied';
                setTimeout(function () { btn.textContent = 'Copy code'; }, 1500);
              });
            }
          });
        }
        // Poll /onboard/status every 3s. The endpoint reflects pairing_sessions
        // claim state. Once paired, redirect to /onboard/success.
        var statusEl = document.getElementById('pair-status');
        var stopped = false;
        function tick() {
          if (stopped) return;
          fetch('/onboard/status', { credentials: 'same-origin' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (j) {
              if (j && j.paired) {
                stopped = true;
                window.location.href = '/onboard/success';
              } else if (statusEl) {
                statusEl.textContent = 'Waiting for your text…';
              }
            })
            .catch(function () {})
            .finally(function () {
              if (!stopped) setTimeout(tick, 3000);
            });
        }
        setTimeout(tick, 3000);
      })();
    </script>`;
}

export function renderOnboardingMobile({ pairingCode, smsUri, agentNumber }) {
  return `
    <section class="panel narrow">
      <p class="eyebrow">Almost done</p>
      <h1>Open Messages to confirm.</h1>
      <p class="lede">We'll send the code through iMessage so your number is bound to your profile. Your first agent message will reference your LinkedIn.</p>
      <a class="button primary" href="${escapeHtml(smsUri)}">Open Messages to confirm</a>
      <p class="fine">Or text <strong>${escapeHtml(pairingCode)}</strong> to <strong>${escapeHtml(agentNumber)}</strong>.</p>
      <p class="fine" id="pair-status">Waiting for your text…</p>
    </section>
    <script>
      (function () {
        var statusEl = document.getElementById('pair-status');
        var stopped = false;
        function tick() {
          if (stopped) return;
          fetch('/onboard/status', { credentials: 'same-origin' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (j) {
              if (j && j.paired) {
                stopped = true;
                window.location.href = '/onboard/success';
              }
            })
            .catch(function () {})
            .finally(function () { if (!stopped) setTimeout(tick, 3000); });
        }
        setTimeout(tick, 3000);
      })();
    </script>`;
}

export function renderOnboardingSuccess() {
  return `
    <section class="panel dark narrow">
      <p class="eyebrow">You're in</p>
      <h1>Locked in.</h1>
      <p class="lede">Maya will reach out shortly. The first text will reference your LinkedIn — school, current role, anything we already know about you.</p>
      <a class="button light" href="/profile">Review profile context</a>
    </section>`;
}

// ─── Startup views (v1.2) ────────────────────────────────────────────────────

export function renderStartupSignIn(config) {
  const signInUrl = getStartupSignInUrl(config);
  return `
    <section class="hero-grid">
      <div>
        <p class="eyebrow">Startup access</p>
        <h1>Reach students through natural messages.</h1>
        <p class="lede">Sign in with email, Google, or Microsoft to set up your company profile and start posting roles.</p>
        <div class="actions">
          <a class="button primary" href="${escapeHtml(signInUrl)}">Get started</a>
        </div>
      </div>
    </section>`;
}

export function renderStartupOnboarding({ startup }) {
  const name = escapeHtml(startup?.name || "");
  const website = escapeHtml(startup?.website || "");
  return `
    <section class="panel narrow">
      <p class="eyebrow">Company profile</p>
      <h1>Tell us about your startup.</h1>
      <form method="POST" action="/startup/onboarding">
        <label>Company name <input name="name" required value="${name}" /></label>
        <label>Website (optional) <input name="website" type="url" value="${website}" /></label>
        <label class="checkbox-row">
          <input type="checkbox" name="consent_messaging" value="1" required />
          I agree that InternJobs.ai will send messages to students on behalf of my company via an autonomous agent.
          Messages are logged for review and flaggable for follow-up if needed.
        </label>
        <button type="submit" class="button primary">Save and continue</button>
      </form>
    </section>`;
}

export function renderStartupDashboard({ startup, roles }) {
  const rows = roles
    .map(
      (r) => `
    <tr>
      <td>${escapeHtml(r.title)}</td>
      <td>${escapeHtml(r.status)}</td>
      <td>${new Date(r.created_at).toLocaleDateString()}</td>
      <td>
        <a href="/startup/roles/${escapeHtml(r.id)}/edit">Edit</a>
        ${
          r.status !== "paused"
            ? `<form method="POST" action="/startup/roles/${escapeHtml(r.id)}/pause" style="display:inline"><button type="submit">Pause</button></form>`
            : ""
        }
      </td>
    </tr>`,
    )
    .join("");
  return `
    <section class="panel">
      <p class="eyebrow">Dashboard</p>
      <h1>${escapeHtml(startup.name)}</h1>
      <p><a class="button primary" href="/startup/roles/new">+ Add role</a></p>
      ${
        roles.length
          ? `<table><thead><tr><th>Title</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
          : '<p class="lede">No roles yet. Add your first role to get started.</p>'
      }
    </section>`;
}

export function renderRoleForm({ role, action }) {
  const v = (field) => escapeHtml(role?.[field] || "");
  return `
    <section class="panel narrow">
      <p class="eyebrow">Role</p>
      <h1>${role?.id ? "Edit role" : "New role"}</h1>
      <form method="POST" action="${escapeHtml(action)}">
        <label>Title * <input name="title" required value="${v("title")}" /></label>
        <label>Description * <textarea name="description" required rows="4">${v("description")}</textarea></label>
        <label>Requirements * <textarea name="requirements" required rows="4"
          placeholder="e.g. Python, React, 10hr/week commitment">${v("requirements")}</textarea></label>
        <label>Location <select name="location">
          <option value="">— optional —</option>
          ${["Remote", "Onsite", "Hybrid"]
            .map(
              (o) =>
                `<option value="${o.toLowerCase()}" ${role?.location === o.toLowerCase() ? "selected" : ""}>${o}</option>`,
            )
            .join("")}
        </select></label>
        <label>Comp range <input name="comp_range" value="${v("comp_range")}" placeholder="e.g. $20-$25/hr" /></label>
        <button type="submit" class="button primary">Save</button>
        <a href="/startup/dashboard">Cancel</a>
      </form>
    </section>`;
}

// ─── Operator audit log views (v1.2 — autonomy pivot 2026-05-17) ────────────
//
// renderMessageLog is the read-only audit log of every agent-drafted
// message, regardless of status. Replaces the prior renderDraftQueue
// (which showed only status='pending_review' approval-queue rows). After
// the autonomy pivot, the agent sends autonomously and operators view
// what was sent here; the only mutating action is the per-row "Flag for
// review" link, which writes a draft_feedback row (feedback_type='flagged')
// without changing the draft itself.

function statusBadge(status) {
  const known = {
    sent: ["badge-fresh", "Sent"],
    failed: ["badge-stale", "Failed"],
    sending: ["badge-stale", "Sending"],
    flagged: ["badge-stale", "Flagged"],
    // Legacy pre-pivot states. Kept so historical rows still render.
    pending_review: ["badge-stale", "Pending (legacy)"],
    approved: ["badge-stale", "Approved (legacy)"],
    rejected: ["badge-stale", "Rejected (legacy)"],
  };
  const [cls, label] = known[status] || ["badge-stale", String(status || "—")];
  return `<span class="badge ${cls}">${escapeHtml(label)}</span>`;
}

export function renderMessageLog({ drafts, filter, page, banner }) {
  const safeFilter = filter === "student" || filter === "startup" ? filter : "";
  const linkFor = (t) => {
    const params = new URLSearchParams();
    if (t) params.set("type", t);
    if (page && page > 0) params.set("page", String(page));
    const qs = params.toString();
    return `/ops/drafts${qs ? `?${qs}` : ""}`;
  };

  const filterBar = `
    <nav class="ops-filter">
      <a href="${linkFor("")}" ${!safeFilter ? "aria-current=\"page\"" : ""}>All</a>
      <a href="${linkFor("student")}" ${safeFilter === "student" ? "aria-current=\"page\"" : ""}>Student</a>
      <a href="${linkFor("startup")}" ${safeFilter === "startup" ? "aria-current=\"page\"" : ""}>Startup</a>
    </nav>`;

  if (!drafts.length) {
    return `
      <section class="panel">
        <p class="eyebrow">Message log</p>
        <h1>No messages yet.</h1>
        ${banner || ""}
        ${filterBar}
        <p class="lede">The agent has not produced any messages yet. As students and startups exchange messages, this log will fill up — every send is recorded here for post-hoc review.</p>
      </section>`;
  }

  const rows = drafts
    .map((d) => {
      const ageMin = Math.max(0, Math.floor((Date.now() - new Date(d.created_at).getTime()) / 60000));
      const ageLabel = ageMin < 60 ? `${ageMin}m ago` : `${Math.floor(ageMin / 60)}h ${ageMin % 60}m ago`;
      const recipientBadge = `<span class="badge ${d.recipient_type === "student" ? "badge-student" : "badge-startup"}">${escapeHtml((d.recipient_type || "").toUpperCase())}</span>`;
      const ageBadge = `<span class="badge badge-fresh">${escapeHtml(ageLabel)}</span>`;
      const preview = String(d.body || "").slice(0, 120);
      return `
        <tr>
          <td>${statusBadge(d.status)}</td>
          <td>${recipientBadge}</td>
          <td>${escapeHtml(d.student_name || "—")}</td>
          <td>${escapeHtml(d.startup_name || "—")}</td>
          <td>${escapeHtml(d.role_title || "—")}</td>
          <td class="ops-body-cell">${escapeHtml(preview)}${d.body?.length > 120 ? "…" : ""}</td>
          <td>${ageBadge}</td>
          <td><a class="button secondary small" href="/ops/drafts/${escapeHtml(d.id)}">View</a></td>
        </tr>`;
    })
    .join("");

  return `
    <section class="panel">
      <p class="eyebrow">Message log</p>
      <h1>Sent &amp; flagged messages</h1>
      ${banner || ""}
      ${filterBar}
      <p class="lede">Read-only audit log. The agent sends autonomously; flag any message that needs prompt-tuning review.</p>
      <table class="ops-table">
        <thead>
          <tr>
            <th>Status</th>
            <th>Type</th>
            <th>Student</th>
            <th>Startup</th>
            <th>Role</th>
            <th>Preview</th>
            <th>Age</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

// Back-compat re-export so external callers (none in tree, but defensive)
// don't break if they imported the old name.
export const renderDraftQueue = renderMessageLog;

export function renderDraftDetail({ draft, priorMessages = [], errorBanner }) {
  const ageMin = Math.max(0, Math.floor((Date.now() - new Date(draft.created_at).getTime()) / 60000));
  const sentSuffix = draft.sent_at
    ? ` &middot; sent ${escapeHtml(new Date(draft.sent_at).toLocaleString())}`
    : "";
  const draftedAt = `<p class="fine">Drafted ${ageMin}m ago at ${escapeHtml(new Date(draft.created_at).toLocaleString())}${sentSuffix}</p>`;
  const priorBlock = priorMessages.length
    ? priorMessages
        .map(
          (m) => `<div class="ops-thread-row ops-thread-${escapeHtml(m.direction)}">
            <span class="ops-thread-tag">${escapeHtml(m.direction)}</span>
            <span class="ops-thread-body">${escapeHtml(String(m.body || "").slice(0, 300))}</span>
            <span class="ops-thread-time">${m.created_at ? escapeHtml(new Date(m.created_at).toLocaleString()) : ""}</span>
          </div>`,
        )
        .join("")
    : '<p class="fine">No prior messages in this thread.</p>';

  const providerLine = draft.provider_message_id
    ? `<div><dt>Provider message id</dt><dd>${escapeHtml(draft.provider_message_id)}</dd></div>`
    : "";

  // Show send-error blob when the draft is in 'failed' state.
  const sendErr = draft.agent_metadata?.send_error;
  const sendErrorBlock = draft.status === "failed" && sendErr
    ? `<div class="ops-banner ops-banner-error">Send failed: ${escapeHtml(String(sendErr).slice(0, 300))}</div>`
    : "";

  return `
    <section class="panel">
      <p class="eyebrow">Message detail</p>
      <h1>${escapeHtml(draft.recipient_type === "student" ? "Reply to student" : "Reply to startup")}</h1>
      ${draftedAt}
      ${errorBanner || ""}
      ${sendErrorBlock}

      <div class="ops-detail-grid">
        <div>
          <h2>Context</h2>
          <dl class="details">
            <div><dt>Status</dt><dd>${statusBadge(draft.status)}</dd></div>
            <div><dt>Student</dt><dd>${escapeHtml(draft.student_name || "—")}</dd></div>
            <div><dt>Startup</dt><dd>${escapeHtml(draft.startup_name || "—")}</dd></div>
            <div><dt>Role</dt><dd>${escapeHtml(draft.role_title || "—")}</dd></div>
            <div><dt>Channel</dt><dd>${escapeHtml(draft.channel || "—")} → ${escapeHtml(draft.channel_address || "—")}</dd></div>
            ${providerLine}
            <div><dt>Requirements</dt><dd>${escapeHtml(String(draft.role_requirements || "").slice(0, 300))}</dd></div>
          </dl>
          <h2>Prior messages</h2>
          ${priorBlock}
        </div>

        <div>
          <h2>Message body</h2>
          <pre class="ops-draft-body">${escapeHtml(draft.body || "")}</pre>

          <div class="ops-actions">
            <form method="POST" action="/ops/drafts/${escapeHtml(draft.id)}/flag" class="ops-form-stack">
              <label>Flag for prompt-tuning review (optional reason)
                <input name="flag_reason" placeholder="What's wrong with this message?" />
              </label>
              <p class="fine">This does NOT recall the sent message — the agent already sent it autonomously. Flagging signals the human prompt-tuner that this is a bad output to learn from.</p>
              <button type="submit" class="button warn">Flag for review</button>
            </form>
          </div>
        </div>
      </div>
    </section>`;
}

export function renderFeedbackLog({ rows }) {
  if (!rows.length) {
    return `
      <section class="panel">
        <p class="eyebrow">Flagged messages log</p>
        <h1>No flagged messages yet.</h1>
        <p class="lede">When operators flag autonomous-agent messages for prompt-tuning review, they'll appear here.</p>
      </section>`;
  }
  const tbody = rows
    .map((r) => {
      const original = String(r.original_body || "").slice(0, 200);
      const corrected = r.feedback_type === "edited" ? String(r.corrected_body || "").slice(0, 200) : "";
      return `
        <tr>
          <td><span class="badge ${r.feedback_type === "rejected" || r.feedback_type === "flagged" ? "badge-stale" : "badge-fresh"}">${escapeHtml(r.feedback_type)}</span></td>
          <td>${escapeHtml(r.recipient_type || "—")}</td>
          <td>${escapeHtml(r.student_name || "—")}</td>
          <td>${escapeHtml(r.startup_name || "—")}</td>
          <td>${escapeHtml(r.role_title || "—")}</td>
          <td class="ops-body-cell">${escapeHtml(original)}${r.original_body?.length > 200 ? "…" : ""}</td>
          <td class="ops-body-cell">${escapeHtml(corrected || r.reason || "")}</td>
          <td>${escapeHtml(new Date(r.created_at).toLocaleString())}</td>
        </tr>`;
    })
    .join("");
  return `
    <section class="panel">
      <p class="eyebrow">Flagged messages log</p>
      <h1>Flagged for prompt-tuning review</h1>
      <p class="lede">Operator-flagged messages from the autonomous agent. Legacy 'rejected' / 'edited' rows from the pre-2026-05-17 approval gate may also appear if the filter is widened.</p>
      <table class="ops-table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Recipient</th>
            <th>Student</th>
            <th>Startup</th>
            <th>Role</th>
            <th>Original</th>
            <th>Reason</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>${tbody}</tbody>
      </table>
    </section>`;
}

function styles() {
  return `
    :root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#111;background:#f7f4ed}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 20% 12%,#ffe4f0,transparent 26%),radial-gradient(circle at 82% 4%,#ddecff,transparent 28%),linear-gradient(180deg,#fbf7ef,#f4efe6 58%,#eef7f2);color:#111}
    a{color:inherit}.topbar{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.9rem 1.2rem;background:rgba(251,247,239,.82);backdrop-filter:blur(18px);border-bottom:1px solid rgba(0,0,0,.07)}
    .brand{display:flex;align-items:center;gap:.55rem;text-decoration:none}.logo{display:grid;place-items:center;width:1.75rem;height:1.75rem;border-radius:.5rem;background:#111;color:#fff;font-weight:900}nav{display:flex;gap:.75rem;font-size:.82rem;font-weight:800}nav a{text-decoration:none;color:#45443f}
    .config-banner{padding:.75rem 1.2rem;background:#fff7d6;color:#5f4b00;font-size:.85rem;font-weight:800;border-bottom:1px solid rgba(0,0,0,.08)}
    main{width:min(1120px,calc(100vw - 2rem));margin:0 auto;padding:4rem 0}.hero-grid,.panel-grid,.pair-grid{display:grid;grid-template-columns:1.05fr .95fr;gap:2rem;align-items:center}.hero-grid{min-height:72vh}
    .eyebrow{margin:0 0 1rem;font-size:.73rem;font-weight:950;text-transform:uppercase;letter-spacing:.12em;color:#6f6c64}h1{max-width:700px;margin:0;font-size:clamp(3rem,8vw,6.8rem);line-height:.86;letter-spacing:0;font-weight:1000}h2{margin:.2rem 0 1rem;font-size:2rem;line-height:.96}.lede{max-width:620px;color:#5f625d;font-size:1.06rem;line-height:1.65}.fine{color:#77736b;font-size:.85rem;line-height:1.5}.actions{display:flex;gap:.8rem;flex-wrap:wrap;margin-top:1.5rem}.button{display:inline-flex;align-items:center;justify-content:center;min-height:3rem;border:0;border-radius:999px;padding:0 1.2rem;text-decoration:none;font-weight:950;cursor:pointer}.primary{background:#111;color:#fff}.secondary{background:#fff;color:#111;border:1px solid rgba(0,0,0,.1)}.light{background:#fff;color:#111}
    .phone-card,.panel{border:1px solid rgba(0,0,0,.08);border-radius:1.2rem;background:rgba(255,255,255,.72);box-shadow:0 22px 70px rgba(0,0,0,.08);padding:1.2rem}.dark{background:#111;color:#fff}.dark .lede,.dark .fine{color:rgba(255,255,255,.68)}.narrow{max-width:760px;margin:0 auto}
    .thread{display:flex;min-height:32rem;flex-direction:column;justify-content:flex-end;gap:.7rem;padding:1rem;border-radius:2rem;background:#fbfbf8}.thread p{max-width:78%;margin:0;padding:.75rem .9rem;border-radius:1.1rem;font-size:.92rem;line-height:1.35}.agent{align-self:flex-start;background:#e9e9eb}.student{align-self:flex-end;background:#007aff;color:#fff}
    .details{display:grid;gap:.85rem}.details div{padding:.8rem;border-radius:.7rem;background:rgba(0,0,0,.04)}dt{font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;color:#77736b;font-weight:900}dd{margin:.15rem 0 0;overflow-wrap:anywhere;font-weight:800}.qr-wrap{display:grid;place-items:center;margin-top:1.4rem}.qr-wrap img{border-radius:1rem;background:#fff;padding:.8rem}.pair-code{margin:1.2rem 0;font-size:clamp(2.4rem,8vw,5rem);line-height:1;font-weight:1000;letter-spacing:.04em}.message-preview{margin:1rem 0;padding:1rem;border-radius:1rem;background:rgba(255,255,255,.12);color:#fff;font-weight:800;line-height:1.45}.form{display:grid;gap:1rem}label{display:grid;gap:.45rem;font-weight:900}label span{font-size:.75rem;color:#77736b}input,textarea{width:100%;border:1px solid rgba(0,0,0,.12);border-radius:.8rem;background:#fff;padding:.9rem 1rem;font:inherit;color:#111}
    footer{display:flex;justify-content:space-between;gap:1rem;padding:2rem 1.2rem;color:#77736b;font-size:.82rem;font-weight:800}@media(max-width:760px){nav{display:none}main{padding:2.5rem 0}.hero-grid,.panel-grid,.pair-grid{grid-template-columns:1fr}h1{font-size:3.2rem}.thread{min-height:26rem}}
    /* v1.2 Phase 05 — operator approval gate */
    .ops-filter{display:flex;gap:.7rem;margin:1rem 0 1.5rem;font-weight:800;font-size:.85rem}.ops-filter a{padding:.4rem .9rem;border-radius:999px;text-decoration:none;background:#eee;color:#333}.ops-filter a[aria-current="page"]{background:#111;color:#fff}
    .ops-table{width:100%;border-collapse:collapse;margin-top:1rem;font-size:.9rem}.ops-table th,.ops-table td{padding:.7rem .8rem;text-align:left;border-bottom:1px solid rgba(0,0,0,.08);vertical-align:top}.ops-table th{font-size:.7rem;text-transform:uppercase;letter-spacing:.06em;color:#77736b}.ops-body-cell{max-width:24rem;color:#5f625d}
    .badge{display:inline-block;padding:.18rem .55rem;border-radius:999px;font-size:.68rem;font-weight:900;letter-spacing:.04em;text-transform:uppercase}.badge-student{background:#dceaff;color:#143a8a}.badge-startup{background:#ffe2c2;color:#7a3f00}.badge-fresh{background:#e0f3df;color:#0f5d2c}.badge-stale{background:#ffd6d6;color:#8a1212}
    .ops-detail-grid{display:grid;grid-template-columns:1fr 1.1fr;gap:2rem;margin-top:1.5rem}.ops-detail-grid h2{font-size:1.1rem;margin:1.4rem 0 .6rem}
    .ops-draft-body{padding:1rem;background:#f4f1e8;border-radius:.8rem;border:1px solid rgba(0,0,0,.08);font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:.9rem;white-space:pre-wrap;word-break:break-word}
    .ops-actions{display:flex;flex-direction:column;gap:1rem;margin-top:1rem}.ops-form-inline,.ops-form-stack{display:flex;flex-direction:column;gap:.5rem;padding:.9rem 1rem;border-radius:.8rem;background:rgba(0,0,0,.03)}.ops-form-stack textarea{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:.85rem}
    .button.small{min-height:2.2rem;padding:0 .8rem;font-size:.78rem}.button.warn{background:#a01b1b;color:#fff}
    .ops-thread-row{display:grid;grid-template-columns:5rem 1fr 9rem;gap:.6rem;padding:.55rem .7rem;border-radius:.5rem;background:rgba(0,0,0,.03);margin-bottom:.4rem;font-size:.85rem}.ops-thread-inbound{border-left:3px solid #1462e3}.ops-thread-outbound{border-left:3px solid #0f5d2c}.ops-thread-tag{font-size:.65rem;text-transform:uppercase;letter-spacing:.05em;color:#77736b;font-weight:900}.ops-thread-time{font-size:.7rem;color:#77736b;text-align:right}
    .ops-banner{padding:.85rem 1rem;border-radius:.6rem;font-weight:800;font-size:.88rem;margin:1rem 0}.ops-banner-ok{background:#e0f3df;color:#0f5d2c}.ops-banner-warn{background:#fff2cc;color:#7a5b00}.ops-banner-error{background:#ffd6d6;color:#8a1212}
    @media(max-width:760px){.ops-detail-grid{grid-template-columns:1fr}.ops-table{font-size:.8rem}}
  `;
}

function firstName(name) {
  return String(name || "").trim().split(/\s+/)[0] || "";
}
