type CastsJson = {
  generatedAt?: string;
  byImdbId?: Record<string, string[]>;
};

let castsPromise: Promise<Map<string, string[]>> | null = null;

export async function loadCastsByImdbId(): Promise<Map<string, string[]>> {
  if (castsPromise) return castsPromise;

  castsPromise = (async () => {
    try {
      const resp = await fetch('/cast_by_imdb.json', { cache: 'force-cache' });
      if (!resp.ok) return new Map();
      const data: CastsJson = await resp.json().catch(() => ({} as any));
      const byImdbId = data && typeof data === 'object' && data.byImdbId && typeof data.byImdbId === 'object' ? data.byImdbId : {};
      const out = new Map<string, string[]>();
      for (const [k, v] of Object.entries(byImdbId)) {
        const imdbId = String(k || '').trim();
        if (!/^tt\d+$/i.test(imdbId)) continue;
        const arr = Array.isArray(v) ? v.map((x) => String(x || '').trim()).filter(Boolean) : [];
        if (!arr.length) continue;
        out.set(imdbId, arr);
      }
      return out;
    } catch {
      return new Map();
    }
  })();

  return castsPromise;
}
