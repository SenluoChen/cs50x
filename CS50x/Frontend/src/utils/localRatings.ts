type RatingsJson = {
  generatedAt?: string;
  byImdbId?: Record<string, number>;
  byTmdbId?: Record<string, number>;
};

type RatingsIndex = {
  byImdbId: Map<string, number>;
  byTmdbId: Map<number, number>;
};

let ratingsIndexPromise: Promise<RatingsIndex> | null = null;

function parseRatingsJson(data: RatingsJson): RatingsIndex {
  const byImdbIdRaw =
    data && typeof data === "object" && data.byImdbId && typeof data.byImdbId === "object" ? data.byImdbId : {};
  const byTmdbIdRaw =
    data && typeof data === "object" && data.byTmdbId && typeof data.byTmdbId === "object" ? data.byTmdbId : {};

  const byImdbId = new Map<string, number>();
  for (const [k, v] of Object.entries(byImdbIdRaw)) {
    const imdbId = String(k || "").trim();
    if (!/^tt\d+$/i.test(imdbId)) continue;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) continue;
    byImdbId.set(imdbId, n);
  }

  const byTmdbId = new Map<number, number>();
  for (const [k, v] of Object.entries(byTmdbIdRaw)) {
    const tmdbId = Number(k);
    if (!Number.isFinite(tmdbId) || tmdbId <= 0) continue;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) continue;
    byTmdbId.set(tmdbId, n);
  }

  return { byImdbId, byTmdbId };
}

async function fetchRatingsIndex(): Promise<RatingsIndex> {
  if (ratingsIndexPromise) return ratingsIndexPromise;

  ratingsIndexPromise = (async () => {
    try {
      const resp = await fetch("/ratings_1000.json", { cache: "force-cache" });
      if (!resp.ok) return { byImdbId: new Map(), byTmdbId: new Map() };
      const data: RatingsJson = await resp.json().catch(() => ({} as any));
      return parseRatingsJson(data);
    } catch {
      return { byImdbId: new Map(), byTmdbId: new Map() };
    }
  })();

  return ratingsIndexPromise;
}

export async function getRatingByImdbId(imdbId: string): Promise<number | undefined> {
  const id = String(imdbId || "").trim();
  if (!/^tt\d+$/i.test(id)) return undefined;
  const idx = await fetchRatingsIndex();
  return idx.byImdbId.get(id);
}

export async function getRatingByTmdbId(tmdbId: number): Promise<number | undefined> {
  const id = Number(tmdbId);
  if (!Number.isFinite(id) || id <= 0) return undefined;
  const idx = await fetchRatingsIndex();
  return idx.byTmdbId.get(id);
}

export function warmRatingsCacheInBackground(): void {
  if (typeof window === "undefined") return;
  try {
    const ric = (window as any).requestIdleCallback as undefined | ((cb: () => void, opts?: any) => any);
    if (typeof ric === "function") {
      ric(() => {
        fetchRatingsIndex().catch(() => void 0);
      }, { timeout: 1500 });
      return;
    }
  } catch {
    // ignore
  }

  setTimeout(() => {
    fetchRatingsIndex().catch(() => void 0);
  }, 0);
}
