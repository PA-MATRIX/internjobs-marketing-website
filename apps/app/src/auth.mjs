import { createPublicKey, createVerify } from "node:crypto";
import { parseCookies, signValue, verifySignedValue } from "./http.mjs";

const devCookie = "internjobs_dev_session";

export function setDevSessionCookie(res, config) {
  const payload = Buffer.from(
    JSON.stringify({
      sub: "dev_jordan_linkedin",
      email: "jordan@student.edu",
      name: "Jordan Lee",
      linkedinProfileUrl: "https://www.linkedin.com/in/jordan-builder",
      provider: "linkedin",
    }),
  ).toString("base64url");
  const signed = signValue(payload, config.appSessionSecret);

  res.setHeader("set-cookie", `${devCookie}=${encodeURIComponent(signed)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);
}

export function clearDevSessionCookie(res) {
  res.setHeader("set-cookie", `${devCookie}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export async function getAuth(req, config) {
  const cookies = parseCookies(req.headers.cookie || "");

  if (config.enableDevAuth && cookies[devCookie]) {
    const payload = verifySignedValue(cookies[devCookie], config.appSessionSecret);
    if (payload) {
      const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      return normalizeClaims(claims, "dev");
    }
  }

  const sessionJwt = cookies.__session || bearerToken(req);
  if (sessionJwt && config.clerk.jwksUrl) {
    const claims = await verifyJwtWithJwks(sessionJwt, config.clerk.jwksUrl);
    if (claims) return normalizeClaims(claims, "clerk");
  }

  if (!config.isProduction && req.headers["x-clerk-user-id"]) {
    return normalizeClaims(
      {
        sub: String(req.headers["x-clerk-user-id"]),
        email: req.headers["x-student-email"],
        name: req.headers["x-student-name"],
      },
      "header-dev",
    );
  }

  return null;
}

export function getSignInUrl(config) {
  if (config.clerk.signInUrl) {
    const url = new URL(config.clerk.signInUrl, config.appUrl);
    url.searchParams.set("redirect_url", `${config.appUrl}/auth/callback`);
    return url.toString();
  }

  if (config.enableDevAuth) return "/dev/sign-in";
  return "#configuration-needed";
}

function bearerToken(req) {
  const header = req.headers.authorization;
  if (typeof header !== "string") return "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
}

function normalizeClaims(claims, source) {
  return {
    clerkUserId: claims.sub || claims.user_id || claims.id,
    email: claims.email || claims.email_address || claims.primary_email_address || "",
    name: claims.name || [claims.given_name, claims.family_name].filter(Boolean).join(" ") || "",
    imageUrl: claims.picture || claims.image_url || "",
    linkedinProfileUrl: claims.linkedinProfileUrl || claims.linkedin_profile_url || claims.profile || "",
    provider: claims.provider || "linkedin",
    source,
    raw: redactClaims(claims),
  };
}

function redactClaims(claims) {
  const clone = { ...claims };
  delete clone.__raw;
  delete clone.sid;
  delete clone.azp;
  return clone;
}

async function verifyJwtWithJwks(jwt, jwksUrl) {
  const [encodedHeader, encodedPayload, encodedSignature] = jwt.split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) return null;

  const header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8"));
  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  if (payload.exp && Date.now() / 1000 > payload.exp) return null;

  const response = await fetch(jwksUrl);
  if (!response.ok) return null;
  const jwks = await response.json();
  const key = jwks.keys?.find((item) => item.kid === header.kid);
  if (!key) return null;

  const publicKey = createPublicKey({ key, format: "jwk" });
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${encodedHeader}.${encodedPayload}`);
  verifier.end();

  return verifier.verify(publicKey, Buffer.from(encodedSignature, "base64url")) ? payload : null;
}
