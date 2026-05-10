import QRCode from "qrcode";
import { escapeHtml } from "./http.mjs";
import { getMissingProviderConfig } from "./config.mjs";
import { getSignInUrl } from "./auth.mjs";

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
  `;
}

function firstName(name) {
  return String(name || "").trim().split(/\s+/)[0] || "";
}
