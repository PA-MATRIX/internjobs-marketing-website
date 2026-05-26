# GENZ-01: Mattermost GIF Plugin Install Runbook

**Status:** Operator-deferred (requires `mmctl` access + Tenor API key)
**Target server:** chat.internjobs.ai (self-hosted Mattermost)
**Plugin:** `com.github.moussetc.mattermost.plugin.giphy` (community plugin, Tenor provider)

---

## Why deferred + why Tenor

The hosted Mattermost Plugin Marketplace dropped this plugin in September 2023,
so install is by tarball via `mmctl plugin add` only — no web-console one-click.
That requires `mmctl` authenticated to the production server, which the
executor environment does not have.

**Provider decision: Tenor (Google), not GIPHY.** GIPHY's free tier was
deprecated and most new keys require a paid plan. Tenor is free, Google-owned,
and supported by the plugin's modern releases. No billing setup required.

---

## Pre-flight checks

1. Verify Mattermost server version is 6.5 or higher:
   ```bash
   mmctl version
   ```
   Expected: `Server version: 7.x.x` or higher. If below 6.5, stop — plugin
   is incompatible.

2. Confirm `mmctl` is authenticated to chat.internjobs.ai:
   ```bash
   mmctl auth list
   ```
   Should show an entry for `chat.internjobs.ai`. If not, authenticate:
   ```bash
   mmctl auth login https://chat.internjobs.ai --username admin --password <admin-password>
   ```
   (Use a system-admin account. Password lives in 1Password under
   "Mattermost admin – chat.internjobs.ai".)

---

## Step 1 — Get a Tenor API key

1. Go to https://console.cloud.google.com/
2. Create a new project (or use an existing one — `internjobs-mattermost`
   is a reasonable name).
3. Enable the Tenor API: **APIs & Services > Library**, search "Tenor API",
   click **Enable**.
4. Create the key: **APIs & Services > Credentials > Create Credentials
   > API Key**.
5. Copy the key (format: `AIza...`). Store it in 1Password as
   **"Tenor API key – internjobs"**.

Optional but recommended: restrict the key under **API restrictions** to
"Tenor API" only.

---

## Step 2 — Download the plugin

Download the latest release tarball from:
https://github.com/moussetc/mattermost-plugin-giphy/releases

File format: `com.github.moussetc.mattermost.plugin.giphy-vX.Y.Z.tar.gz`

As of Phase 26 research (2026-05-27) the latest tag is v3.0.x.

---

## Step 3 — Install the plugin

```bash
mmctl plugin add ./com.github.moussetc.mattermost.plugin.giphy-vX.Y.Z.tar.gz
mmctl plugin enable com.github.moussetc.mattermost.plugin.giphy
```

Verify:

```bash
mmctl plugin list
```

Should show `com.github.moussetc.mattermost.plugin.giphy` with status
`active` (enabled + running). If status is `installed` only, re-run the
`enable` command.

---

## Step 4 — Configure the Tenor provider

In the Mattermost System Console (https://chat.internjobs.ai/admin_console):

1. Navigate to **Plugins > GIF commands** (the plugin registers itself here
   after enable).
2. Set **Provider** = `Tenor`.
3. Paste the Tenor API key from Step 1 into the **API key** field.
4. Set **Rating** to `PG` (default — keeps the team-channel-safe filter on).
5. Click **Save**.

---

## Step 5 — Verify in chat

In any Mattermost channel at chat.internjobs.ai (a `#test` or `#bots`
channel is ideal):

```
/gif hello
```

Expected: a Tenor GIF appears inline in the message composer for preview
before posting.

```
/gifs congrats
```

Expected: a **Shuffle** button appears letting the operator cycle through
GIF options before posting.

If the slash commands are unknown, the plugin did not enable — re-run
`mmctl plugin list` and confirm `active`.

---

## Step 6 — Capture evidence

After successful install, screenshot:

1. The System Console plugin list showing the plugin **active**.
2. A `/gif hello` preview rendered in a test channel.

Save the screenshot as:
```
apps/parrot/docs/evidence/genz-01-gif-plugin-verified.png
```

Then mark the deferred item complete in
`.planning/workstreams/team-workspace/STATE.md` under the Phase 26
**Open Items** section.

---

## Rollback (if needed)

```bash
mmctl plugin disable com.github.moussetc.mattermost.plugin.giphy
mmctl plugin delete  com.github.moussetc.mattermost.plugin.giphy
```

No data is persisted by the plugin (Tenor calls are stateless), so removal
is clean.
