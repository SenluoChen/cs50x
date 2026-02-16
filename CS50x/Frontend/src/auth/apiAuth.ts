import type { AuthUser } from "./types";

type SignupResult = { next: "confirm" | "done"; userConfirmed: boolean };

function inferDefaultAuthBase(): string {
  try {
    const host = String(window.location.hostname || '').toLowerCase();
    const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0';
    // For local development (CRA dev server) prefer relative paths so CRA proxy can forward to the mock backend.
    const port = String(window.location.port || '');
    if (isLocal && port === '3000') return '';
    return isLocal ? 'http://localhost:3001' : window.location.origin;
  } catch {
    return 'http://localhost:3001';
  }
}

function normalizeAuthBase(rawBase: string): string {
  const cleaned = String(rawBase || "").trim().replace(/\/+$/, "");
  try {
    const pageHost = String(window.location.hostname || "").trim();
    const pagePort = String(window.location.port || "").trim();
    const url = new URL(cleaned);

    // If UI is being accessed from LAN (e.g. http://192.168.x.x:3000) but the env still
    // points to localhost:3001, rewrite to the current hostname so phones/other devices work.
    const isPageDev = pagePort === "3000";
    const isEnvLoopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    const isPageLoopback = pageHost === "localhost" || pageHost === "127.0.0.1" || pageHost === "0.0.0.0";
    if (isPageDev && isEnvLoopback && !isPageLoopback && pageHost) {
      url.hostname = pageHost;
      url.port = "3001";
      return url.toString().replace(/\/+$/, "");
    }
  } catch {
    // ignore, fallback to cleaned
  }
  return cleaned;
}

const base = normalizeAuthBase(process.env.REACT_APP_AUTH_API_BASE || inferDefaultAuthBase());

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    credentials: "include",
  });

  const text = await res.text().catch(() => "");
  const contentType = res.headers.get("content-type") || "";

  let json: any = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      const snippet = text.slice(0, 160).replace(/\s+/g, " ").trim();
      const hint = snippet.startsWith("<!DOCTYPE") || snippet.startsWith("<html") ? "(看起來像 HTML；可能打到前端 dev server 或 404)" : "";

      // If server didn't return JSON, surface a useful error instead of "Unexpected token '<'".
      throw new Error(
        `Auth API 回傳非 JSON：HTTP ${res.status} ${res.statusText} ${hint}. ` +
          `REACT_APP_AUTH_API_BASE=${base}. content-type=${contentType || "(none)"}. ` +
          `body="${snippet}"`
      );
    }
  }

  if (!res.ok) {
    const msg = String(json?.error || res.statusText || "Request failed");
    throw new Error(msg);
  }

  return json as T;
}

export async function apiMe(): Promise<AuthUser> {
  const out = await api<{ ok: true; user: AuthUser }>("/auth/me", { method: "GET" });
  return out.user;
}

export async function apiRefresh(): Promise<AuthUser> {
  const out = await api<{ ok: true; user: AuthUser }>("/auth/refresh", { method: "POST", body: "{}" });
  return out.user;
}

export async function apiLogin(email: string, password: string): Promise<AuthUser> {
  const out = await api<{ ok: true; user: AuthUser }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  return out.user;
}

export async function apiSignup(email: string, password: string): Promise<SignupResult> {
  const out = await api<{ ok: true; next: "confirm" | "done"; userConfirmed: boolean }>("/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  return { next: out.next, userConfirmed: out.userConfirmed };
}

export async function apiConfirm(email: string, code: string): Promise<void> {
  const normalizedCode = String(code || "").trim().replace(/[\s-]+/g, "");
  await api<{ ok: true }>("/auth/confirm", {
    method: "POST",
    body: JSON.stringify({ email, code: normalizedCode }),
  });
}

export async function apiResend(email: string): Promise<void> {
  await api<{ ok: true }>("/auth/resend", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function apiForgotPassword(email: string): Promise<void> {
  await api<{ ok: true }>("/auth/forgot", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function apiResetPassword(email: string, code: string, newPassword: string): Promise<void> {
  const normalizedCode = String(code || "").trim().replace(/[\s-]+/g, "");
  await api<{ ok: true }>("/auth/reset", {
    method: "POST",
    body: JSON.stringify({ email, code: normalizedCode, newPassword }),
  });
}

export async function apiLogout(): Promise<void> {
  await api<{ ok: true }>("/auth/logout", { method: "POST", body: "{}" });
}
