# v1.2 Phase 10 Wave 2 — Self-hosted Mattermost Team Edition for Parrot.
#
# Mattermost Team Edition is MIT-licensed and free. Daily.co ships an
# official plugin that we install in Wave 3 to add /daily + start-meeting
# CTAs inside channels.
#
# Pinned to 11.6.2 (latest stable patch on the 11.6 release line as of
# 2026-05-18). Bump deliberately, not via `:latest`.
#
# Mattermost reads most settings from MM_<SECTION>_<KEY> env vars at
# startup and merges them onto config/config.json, so this image stays
# intentionally thin — all config + secrets are injected via
# `flyctl secrets set` (see README.md).
FROM mattermost/mattermost-team-edition:11.6.2

# Mattermost binds to 8065 by default; expose it so Fly can route :443
# traffic through its proxy into the container.
EXPOSE 8065

# The upstream image already declares the right user, entrypoint, volume
# layout (/mattermost/data, /mattermost/logs, /mattermost/config,
# /mattermost/plugins, /mattermost/client/plugins) and CMD. We rely on
# those defaults rather than re-implementing them.
