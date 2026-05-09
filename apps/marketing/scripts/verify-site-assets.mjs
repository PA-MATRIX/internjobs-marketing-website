import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const getArg = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const distDir = getArg("--dist");
const baseUrl = getArg("--url");
const requiredRoutes = ["/", "/startups", "/privacy", "/terms"];
const requiredCssMarkers = [".page-shell", ".hero-spectrum", ".startup-slack-sidebar", ".legal-page"];

function fail(message) {
  console.error(`verify-site-assets failed: ${message}`);
  process.exit(1);
}

function ok(message) {
  console.log(`verify-site-assets: ${message}`);
}

function parseAssets(html) {
  const matches = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => match[1]);
  return matches.filter((asset) => asset.startsWith("/assets/") && (asset.endsWith(".css") || asset.endsWith(".js")));
}

function assertHtmlHasAssets(html, label) {
  const assets = parseAssets(html);
  const cssAssets = assets.filter((asset) => asset.endsWith(".css"));
  const jsAssets = assets.filter((asset) => asset.endsWith(".js"));

  if (cssAssets.length === 0) fail(`${label} has no CSS asset link`);
  if (jsAssets.length === 0) fail(`${label} has no JS asset script`);

  return { assets, cssAssets, jsAssets };
}

function verifyCssContent(css, label) {
  if (css.length < 10_000) fail(`${label} CSS is unexpectedly small (${css.length} bytes)`);
  if (/<!doctype html/i.test(css)) fail(`${label} CSS returned HTML instead of CSS`);

  const missingMarkers = requiredCssMarkers.filter((marker) => !css.includes(marker));
  if (missingMarkers.length > 0) {
    fail(`${label} CSS missing expected app styles: ${missingMarkers.join(", ")}`);
  }
}

function verifyDist() {
  const root = path.resolve(process.cwd(), distDir);
  const indexPath = path.join(root, "index.html");
  const redirectsPath = path.join(root, "_redirects");

  if (!existsSync(indexPath)) fail(`missing ${indexPath}`);
  if (!existsSync(redirectsPath)) fail(`missing ${redirectsPath}; direct routes may 404`);

  const html = readFileSync(indexPath, "utf8");
  const { assets, cssAssets } = assertHtmlHasAssets(html, "dist/index.html");

  for (const asset of assets) {
    const assetPath = path.join(root, asset.replace(/^\//, ""));
    if (!existsSync(assetPath)) fail(`dist/index.html references missing asset ${asset}`);
    const size = statSync(assetPath).size;
    if (size < 1_000) fail(`${asset} is unexpectedly small (${size} bytes)`);
  }

  for (const asset of cssAssets) {
    const css = readFileSync(path.join(root, asset.replace(/^\//, "")), "utf8");
    verifyCssContent(css, asset);
  }

  ok(`dist assets verified (${assets.join(", ")})`);
}

async function fetchText(url, expectedType) {
  let response;
  try {
    response = await fetch(url, { cache: "no-store" });
  } catch (error) {
    fail(`${url} could not be fetched: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!response.ok) fail(`${url} returned ${response.status}`);

  const contentType = response.headers.get("content-type") || "";
  if (expectedType && !contentType.includes(expectedType)) {
    fail(`${url} returned content-type "${contentType}", expected "${expectedType}"`);
  }

  return response.text();
}

async function verifyUrl() {
  const normalizedBase = baseUrl.replace(/\/$/, "");
  const html = await fetchText(`${normalizedBase}/?asset_check=${Date.now()}`, "text/html");
  const { assets, cssAssets } = assertHtmlHasAssets(html, normalizedBase);

  for (const route of requiredRoutes) {
    await fetchText(`${normalizedBase}${route}?route_check=${Date.now()}`, "text/html");
  }

  for (const asset of assets) {
    const expectedType = asset.endsWith(".css") ? "text/css" : "javascript";
    const body = await fetchText(`${normalizedBase}${asset}?asset_check=${Date.now()}`, expectedType);
    if (asset.endsWith(".css")) verifyCssContent(body, `${normalizedBase}${asset}`);
    if (asset.endsWith(".js") && /<!doctype html/i.test(body)) fail(`${asset} returned HTML instead of JS`);
  }

  ok(`production assets verified for ${normalizedBase} (${assets.join(", ")})`);
}

if (!distDir && !baseUrl) fail("pass --dist <dir> and/or --url <base-url>");

if (distDir) verifyDist();
if (baseUrl) await verifyUrl();
