type PlotsJson = {
  generatedAt?: string;
  byImdbId?: Record<string, string>;
};

let plotsPromise: Promise<Map<string, string>> | null = null;

type ParsedPlots = {
  data: PlotsJson;
  map: Map<string, string>;
  etag?: string;
};

let parsedPlotsPromise: Promise<ParsedPlots> | null = null;

type PlotRow = { imdbId: string; plot: string };
type MetaRow = {
  key: string;
  generatedAt?: string;
  etag?: string;
  cachedAt?: number;
};

const DB_NAME = "popcorn-cache";
const DB_VERSION = 1;
const STORE_PLOTS = "plots";
const STORE_META = "meta";
const META_KEY = "plots_by_imdb";

let dbPromise: Promise<IDBDatabase> | null = null;
let ensureIndexPromise: Promise<void> | null = null;

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  if (!isBrowser()) return Promise.reject(new Error("IndexedDB not available"));
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PLOTS)) {
        db.createObjectStore(STORE_PLOTS, { keyPath: "imdbId" });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Failed to open IndexedDB"));
  });

  return dbPromise;
}

function idbRequestToPromise<T = any>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB request failed"));
  });
}

async function setMeta(next: MetaRow): Promise<void> {
  if (!isBrowser()) return;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_META, "readwrite");
    const store = tx.objectStore(STORE_META);
    store.put(next);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed"));
      tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
    });
  } catch {
    // ignore
  }
}

async function getPlotFromDb(imdbId: string): Promise<string> {
  if (!isBrowser()) return "";
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_PLOTS, "readonly");
    const store = tx.objectStore(STORE_PLOTS);
    const row = await idbRequestToPromise<PlotRow | undefined>(store.get(imdbId) as any);
    return row && row.plot ? String(row.plot) : "";
  } catch {
    return "";
  }
}

async function hasAnyPlots(): Promise<boolean> {
  if (!isBrowser()) return false;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_PLOTS, "readonly");
    const store = tx.objectStore(STORE_PLOTS);
    const c = await idbRequestToPromise<number>(store.count());
    return c > 0;
  } catch {
    return false;
  }
}

function parsePlotsJson(data: PlotsJson): Map<string, string> {
  const byImdbId =
    data && typeof data === "object" && data.byImdbId && typeof data.byImdbId === "object" ? data.byImdbId : {};
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(byImdbId)) {
    const imdbId = String(k || "").trim();
    if (!/^tt\d+$/i.test(imdbId)) continue;
    const plot = String(v || "").trim();
    if (!plot) continue;
    out.set(imdbId, plot);
  }
  return out;
}

async function fetchPlotsJsonParsed(): Promise<ParsedPlots> {
  if (parsedPlotsPromise) return parsedPlotsPromise;

  parsedPlotsPromise = (async () => {
    const resp = await fetch("/plots_by_imdb.json", { cache: "force-cache" });
    const etag = String(resp.headers.get("etag") || "").trim() || undefined;
    if (!resp.ok) return { data: {}, map: new Map(), etag };
    const data: PlotsJson = await resp.json().catch(() => ({} as any));
    const map = parsePlotsJson(data);
    return { data, map, etag };
  })();

  return parsedPlotsPromise;
}

async function writePlotsToDb(map: Map<string, string>): Promise<void> {
  if (!isBrowser()) return;
  if (!map.size) return;

  const db = await openDb();
  const entries = Array.from(map.entries());
  const BATCH = 500;

  for (let i = 0; i < entries.length; i += BATCH) {
    const chunk = entries.slice(i, i + BATCH);
    const tx = db.transaction(STORE_PLOTS, "readwrite");
    const store = tx.objectStore(STORE_PLOTS);
    for (const [imdbId, plot] of chunk) {
      store.put({ imdbId, plot } as PlotRow);
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed"));
      tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
    });
    // Yield to keep UI responsive on huge datasets
    await new Promise<void>((r) => setTimeout(r, 0));
  }
}

async function ensurePlotsIndexCached(): Promise<void> {
  if (!isBrowser()) return;
  if (ensureIndexPromise) return ensureIndexPromise;

  ensureIndexPromise = (async () => {
    const already = await hasAnyPlots();
    if (already) return;

    // First-time fill: fetch + parse once, then cache into IndexedDB.
    const parsed = await fetchPlotsJsonParsed().catch(() => ({ data: {}, map: new Map(), etag: undefined } as ParsedPlots));
    if (!parsed.map.size) return;

    await writePlotsToDb(parsed.map);
    await setMeta({
      key: META_KEY,
      generatedAt: String(parsed.data?.generatedAt || "").trim() || undefined,
      etag: parsed.etag,
      cachedAt: Date.now(),
    });
  })().finally(() => {
    // Allow future refresh logic to re-run if needed
    ensureIndexPromise = null;
  });

  return ensureIndexPromise;
}

// Call this once on app start (non-blocking) to avoid first-plot latency later.
export function warmPlotsCacheInBackground(): void {
  if (!isBrowser()) return;
  try {
    // Defer to idle time if available
    const ric = (window as any).requestIdleCallback as undefined | ((cb: () => void, opts?: any) => any);
    if (typeof ric === "function") {
      ric(() => {
        ensurePlotsIndexCached().catch(() => void 0);
      }, { timeout: 1500 });
      return;
    }
  } catch {
    // ignore
  }

  // Fallback: next tick
  setTimeout(() => {
    ensurePlotsIndexCached().catch(() => void 0);
  }, 0);
}

// Best-practice API for pages: get one plot by id (fast path, avoids loading full map)
export async function getPlotByImdbId(imdbId: string): Promise<string> {
  const id = String(imdbId || "").trim();
  if (!/^tt\d+$/i.test(id)) return "";

  // 1) Try IndexedDB first
  const cached = await getPlotFromDb(id);
  if (cached) return cached;

  // 2) Fast path: parse JSON once and return the requested plot without waiting
  // for full IndexedDB population (which can take longer).
  try {
    const parsed = await fetchPlotsJsonParsed();
    const plot = String(parsed.map.get(id) || "").trim();
    if (plot) {
      // Kick off caching in the background (do not block UI)
      ensurePlotsIndexCached().catch(() => void 0);
      return plot;
    }
  } catch {
    // ignore
  }

  // 3) Last resort: attempt to ensure cache and re-read
  try {
    ensurePlotsIndexCached().catch(() => void 0);
  } catch {
    // ignore
  }
  return "";
}

export async function loadPlotsByImdbId(): Promise<Map<string, string>> {
  if (plotsPromise) return plotsPromise;

  plotsPromise = (async () => {
    try {
      // Prefer IndexedDB if available to avoid repeated network + JSON.parse.
      if (isBrowser()) {
        try {
          await ensurePlotsIndexCached();
          const db = await openDb();
          const tx = db.transaction(STORE_PLOTS, "readonly");
          const store = tx.objectStore(STORE_PLOTS);
          const out = new Map<string, string>();

          await new Promise<void>((resolve, reject) => {
            const req = store.openCursor();
            req.onsuccess = () => {
              const cursor = req.result;
              if (!cursor) return resolve();
              const row = cursor.value as PlotRow;
              if (row && row.imdbId && row.plot) out.set(String(row.imdbId), String(row.plot));
              cursor.continue();
            };
            req.onerror = () => reject(req.error || new Error("IndexedDB cursor failed"));
          });

          return out;
        } catch {
          // fall through to network
        }
      }

      const resp = await fetch("/plots_by_imdb.json", { cache: "force-cache" });
      if (!resp.ok) return new Map();
      const data: PlotsJson = await resp.json().catch(() => ({} as any));
      return parsePlotsJson(data);
    } catch {
      return new Map();
    }
  })();

  return plotsPromise;
}
