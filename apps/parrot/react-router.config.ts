// v1.2 Phase 10 Wave 1: Parrot React Router config. Same shape as agentic-inbox.

import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  future: {
    v8_viteEnvironmentApi: true,
  },
} satisfies Config;
