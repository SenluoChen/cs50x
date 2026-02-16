import type { FavoriteMovie } from "./types";

function inferDefaultAuthBase(): string {
  try {
    const host = String(window.location.hostname || '').toLowerCase();
    const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0';
    const port = String(window.location.port || '');
    if (isLocal && port === '3000') return '';
    return isLocal ? 'http://localhost:3001' : window.location.origin;
  } catch {
    return 'http://localhost:3001';
  }
}

function normalizeAuthBase(rawBase: string): string {
  const cleaned = String(rawBase || "").trim().replace(/\s+/g, "").replace(/\/+$/g, "");
  try {
    const pageHost = String(window.location.hostname || "").trim();
    const pagePort = String(window.location.port || "").trim();
    const url = new URL(cleaned);

    const isPageDev = pagePort === "3000";
    const isEnvLoopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    const isPageLoopback = pageHost === "localhost" || pageHost === "127.0.0.1" || pageHost === "0.0.0.0";
    if (isPageDev && isEnvLoopback && !isPageLoopback && pageHost) {
      url.hostname = pageHost;
      url.port = "3001";
      return url.toString().replace(/\/+$/g, "");
    }
  } catch {
    // ignore
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
  let json: any = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      // keep a minimal error; auth/apiAuth.ts already has more detailed messaging
      throw new Error(`Favorites API returned non-JSON (HTTP ${res.status})`);
    }
  }

  if (!res.ok) {
    throw new Error(String(json?.error || res.statusText || "Request failed"));
  }

  return json as T;
}

export async function apiGetFavorites(): Promise<FavoriteMovie[]> {
  const out = await api<{ ok: true; items: FavoriteMovie[] }>("/favorites", { method: "GET" });
  return Array.isArray(out.items) ? out.items : [];
}

export async function apiToggleFavorite(movie: { tmdbId: number; title: string; year?: string; posterUrl?: string }): Promise<FavoriteMovie[]> {
  const out = await api<{ ok: true; items: FavoriteMovie[] }>("/favorites/toggle", {
    method: "POST",
    body: JSON.stringify(movie),
  });
  return Array.isArray(out.items) ? out.items : [];
}
