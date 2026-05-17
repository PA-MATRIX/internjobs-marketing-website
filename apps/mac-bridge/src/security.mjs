import { createHmac, timingSafeEqual } from "node:crypto";

export function signBody(secret, rawBody) {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

export function verifyBody(secret, rawBody, headerValue) {
  if (!headerValue) return false;
  const provided = String(headerValue).replace(/^sha256=/, "");
  const expected = signBody(secret, rawBody);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
