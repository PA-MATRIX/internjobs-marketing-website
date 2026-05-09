import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const port = 3917;
const child = spawn(process.execPath, ["src/server.mjs"], {
  cwd: new URL("..", import.meta.url),
  env: {
    ...process.env,
    PORT: String(port),
  },
  stdio: "ignore",
});

try {
  await delay(350);
  const response = await fetch(`http://127.0.0.1:${port}/healthz`);
  if (!response.ok) {
    throw new Error(`health check returned ${response.status}`);
  }

  const body = await response.json();
  if (body.ok !== true || body.service !== "internjobs-app") {
    throw new Error("health check returned unexpected payload");
  }

  console.log("internjobs-app: health check passed");
} finally {
  child.kill();
}
