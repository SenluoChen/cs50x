export function getSearchApiBaseUrl(): string {
  const raw =
    process.env.REACT_APP_RELIVRE_API_URL ||
    process.env.REACT_APP_API_URL ||
    "";

  const base = String(raw).trim();
  if (base) return base.endsWith("/") ? base : `${base}/`;

  // Defaults when env is not set:
  // - Local dev: semantic search API typically runs on :3002
  // - Production: same-origin so CloudFront /search* behavior works
  try {
    const host = String(window.location.hostname || "").toLowerCase();
    const isLocal = host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0";
    if (isLocal) return "http://localhost:3002/";

    const origin = String(window.location.origin || "").trim();
    if (!origin) return "/";
    return origin.endsWith("/") ? origin : `${origin}/`;
  } catch {
    return "/";
  }
}
