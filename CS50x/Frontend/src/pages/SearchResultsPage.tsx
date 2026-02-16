// note: src/pages/SearchResultsPage.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import { useAuth } from "../auth/AuthContext";
import { useFavorites } from "../favorites/FavoritesContext";
import { tmdbDiscoverMovies, tmdbGetMovieDetails, tmdbImage, type TmdbMovie } from "../utils/tmdb";
import { recommendMovies, type MovieRecommendation } from "../utils/recommendMovies";
import { getPlotByImdbId } from "../utils/localPlots";
import { getRatingByImdbId, getRatingByTmdbId } from "../utils/localRatings";

import FavoriteRoundedIcon from "@mui/icons-material/FavoriteRounded";
import FavoriteBorderRoundedIcon from "@mui/icons-material/FavoriteBorderRounded";

import styles from "../styles/MovieCards.module.css";

type LocalTop10Item = {
  imdbId: string;
  title?: string;
  posterUrl?: string | null;
};

type NavState = {
  results?: MovieRecommendation[];
  q?: string;
};

const SEARCH_CACHE_PREFIX = "popcorn.search.results:";
const DETAILS_CACHE_PREFIX = "popcorn.tmdb.details:";

function searchCacheKey(q: string) {
  return `${SEARCH_CACHE_PREFIX}${String(q || "").trim().toLowerCase()}`;
}

function detailsCacheKey(id: number) {
  return `${DETAILS_CACHE_PREFIX}${id}`;
}

let media1000ImdbByTmdbIdPromise: Promise<Map<number, string>> | null = null;

async function loadMedia1000ImdbByTmdbId(): Promise<Map<number, string>> {
  if (media1000ImdbByTmdbIdPromise) return media1000ImdbByTmdbIdPromise;
  media1000ImdbByTmdbIdPromise = (async () => {
    try {
      const resp = await fetch("/media_1000.json", { cache: "no-cache" });
      if (!resp.ok) return new Map();
      const data = await resp.json().catch(() => ({}));
      const rawByTmdbId = data?.byTmdbId && typeof data.byTmdbId === "object" ? data.byTmdbId : {};

      const map = new Map<number, string>();
      for (const [k, v] of Object.entries(rawByTmdbId)) {
        const tmdbId = Number(k);
        if (!Number.isFinite(tmdbId) || tmdbId <= 0) continue;
        const imdbId = String((v as any)?.imdbId || "").trim();
        if (!/^tt\d+$/i.test(imdbId)) continue;
        if (!map.has(tmdbId)) map.set(tmdbId, imdbId);
      }
      return map;
    } catch {
      return new Map();
    }
  })();
  return media1000ImdbByTmdbIdPromise;
}

let topRated10Promise: Promise<TmdbMovie[]> | null = null;

async function loadTopRated10(): Promise<TmdbMovie[]> {
  if (topRated10Promise) return topRated10Promise;
  topRated10Promise = (async () => {
    try {
      const res = await tmdbDiscoverMovies({
        language: "en-US",
        sort_by: "vote_average.desc",
        vote_count_gte: 500,
        include_adult: false,
        page: 1,
      });
      const list = Array.isArray(res?.results) ? res.results : [];
      // note: Keep it deterministic and small; UI wants exactly 10 cards.
      return list.slice(0, 10);
    } catch {
      // note: Local fallback (works without TMDb key)
      try {
        const resp = await fetch("/media_top10.json", { cache: "no-cache" });
        if (!resp.ok) return [];
        const data = await resp.json().catch(() => ({}));
        const items: LocalTop10Item[] = Array.isArray(data?.items) ? data.items : [];
        return items
          .filter((x) => x && String(x.imdbId || "").trim())
          .slice(0, 10)
          .map((x, i) => {
            const title = String(x?.title || "").trim() || `Top pick ${i + 1}`;
            const posterUrl = (x?.posterUrl ?? null) as string | null;
            return {
              id: -(i + 1),
              title,
              poster_path: null,
              backdrop_path: null,
              release_date: "",
              overview: "",
              vote_average: undefined,
              vote_count: undefined,
              genre_ids: [],
              posterUrl,
              imdbId: String(x.imdbId),
            } as any;
          });
      } catch {
        return [];
      }
    }
  })();
  return topRated10Promise;
}

export default function SearchResultsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const { user } = useAuth();
  const { isFavorite, toggleFavorite } = useFavorites();

  const navState = (location.state ?? {}) as NavState;
  const qFromUrl = String(searchParams.get("q") || "").trim();
  const qFromState = String(navState?.q || "").trim();

  const initialQuery = qFromUrl || qFromState;
  const initialResults = Array.isArray(navState?.results) ? navState.results : [];

  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<MovieRecommendation[]>(initialResults);

  // note: Refresh (F5) loses react-router `location.state`. Cache results per query in sessionStorage
  // so users don't see an "empty" page after refresh.
  useEffect(() => {
    const q = String(searchParams.get("q") || query || "").trim();
    if (!q) return;
    if (!results.length) return;
    try {
      sessionStorage.setItem(searchCacheKey(q), JSON.stringify(results));
    } catch {
      // ignore storage quota / privacy mode
    }
  }, [results, searchParams, query]);

  // note: On hard refresh, try to restore results from cache; if not present, re-run recommendations.
  useEffect(() => {
    const q = String(searchParams.get("q") || "").trim();
    if (!q) return;

    const hadNavResults = Array.isArray(navState?.results) && navState.results.length > 0;
    if (hadNavResults) return;
    if (results.length) return;

    // 1) sessionStorage restore
    try {
      const cached = sessionStorage.getItem(searchCacheKey(q));
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          setResults(parsed as MovieRecommendation[]);
          return;
        }
      }
    } catch {
      // ignore
    }

    // 2) fallback: recompute results from query
    let cancelled = false;
    (async () => {
      try {
        const recs = await recommendMovies(q, { language: "en-US", limit: 12 });
        if (cancelled) return;
        setResults(recs);
        try {
          if (recs.length) sessionStorage.setItem(searchCacheKey(q), JSON.stringify(recs));
        } catch {
          // ignore
        }
      } catch {
        // If TMDb isn't configured, we still render the page (top-rated section remains).
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const [topRated, setTopRated] = useState<Array<TmdbMovie & { tagline?: string; posterUrl?: string | null; imdbId?: string }>>([]);
  const [topRatedLoading, setTopRatedLoading] = useState(false);
  const [topRatedError, setTopRatedError] = useState<string>("");

  const requestedDetailsIdsRef = useRef<Set<number>>(new Set());
  const resolvedDetailsIdsRef = useRef<Set<number>>(new Set());

  const shortIntro = (tagline: string | undefined, overview: string | undefined) => {
    const t = String(tagline || "").trim();
    if (t) return t;
    const o = String(overview || "").trim();
    if (!o) return "";
    // Prefer first sentence as a "short intro".
    const firstSentence = o.split(/(?<=[.!?])\s+/)[0] || o;
    return firstSentence.trim();
  };

  useEffect(() => {
    let cancelled = false;

    // note: Load once per session; cached by module-level promise.
    (async () => {
      setTopRatedLoading(true);
      setTopRatedError("");
      try {
        const list = await loadTopRated10();
        if (cancelled) return;
        setTopRated(list as any);
      } catch (e: any) {
        if (cancelled) return;
        setTopRated([]);
        setTopRatedError(String(e?.message || "Failed to load top rated movies"));
      } finally {
        if (!cancelled) setTopRatedLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function enrichCards() {
      const runWithConcurrency = async <T, R>(arr: T[], limit: number, worker: (v: T) => Promise<R>) => {
        const out: R[] = new Array(arr.length);
        let next = 0;
        const runners = new Array(Math.max(1, limit)).fill(0).map(async () => {
          while (next < arr.length) {
            const i = next++;
            out[i] = await worker(arr[i]);
          }
        });
        await Promise.all(runners);
        return out;
      };

      // 0) Hydrate from sessionStorage cache to make refresh/repeat searches instant.
      const hydrateFromCache = () => {
        const ids = new Set<number>();
        results.forEach((m) => {
          if (Number.isFinite(m.id) && m.id > 0) ids.add(m.id);
        });
        topRated.forEach((m) => {
          if (Number.isFinite(m.id) && m.id > 0) ids.add(m.id);
        });

        const cachedById = new Map<number, { overview?: string; tagline?: string; original_language?: string; vote_average?: number }>();
        ids.forEach((id) => {
          try {
            const raw = sessionStorage.getItem(detailsCacheKey(id));
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return;
            cachedById.set(id, {
              overview: typeof parsed.overview === 'string' ? parsed.overview : undefined,
              tagline: typeof parsed.tagline === 'string' ? parsed.tagline : undefined,
              original_language: typeof parsed.original_language === 'string' ? parsed.original_language : undefined,
              vote_average: typeof parsed.vote_average === 'number' && Number.isFinite(parsed.vote_average) ? parsed.vote_average : undefined,
            });
            resolvedDetailsIdsRef.current.add(id);
          } catch {
            // ignore
          }
        });

        if (!cachedById.size) return;

        setResults((prev) => {
          let changed = false;
          const next = prev.map((m) => {
            const c = cachedById.get(m.id);
            if (!c) return m;
            const overview = String(m.overview || '').trim() ? m.overview : (c.overview ?? m.overview);
            const tagline = m.tagline || c.tagline;
            const original_language = m.original_language || c.original_language;
            const vote_average = typeof m.vote_average === 'number' ? m.vote_average : c.vote_average;
            if (overview !== m.overview || tagline !== m.tagline || original_language !== m.original_language || vote_average !== m.vote_average) {
              changed = true;
              return { ...m, overview, tagline, original_language, vote_average };
            }
            return m;
          });
          return changed ? next : prev;
        });

        setTopRated((prev) => {
          let changed = false;
          const next = prev.map((m) => {
            const c = cachedById.get(m.id);
            if (!c) return m;
            const nextTagline = String(m.tagline || '').trim() ? m.tagline : (c.tagline ?? m.tagline);
            if (nextTagline !== m.tagline) {
              changed = true;
              return { ...m, tagline: nextTagline };
            }
            return m;
          });
          return changed ? next : prev;
        });
      };

      hydrateFromCache();

      // 0.5) Prefer local plots for ALL cards so card plot matches MovieDetail Overview.
      // note: This does NOT block initial render; it just replaces `overview` once local data is ready.
      // note: Tagline enrichment remains as-is.
      const filledLocalOverviewIds = new Set<number>();
      try {
        const tmdbToImdb = await loadMedia1000ImdbByTmdbId();

        const candidates = [...results, ...topRated].filter((m) => {
          const idOk = Number.isFinite(m.id) && m.id > 0;
          const directImdbId = String((m as any)?.imdbId || "").trim();
          const imdbOk = /^tt\d+$/i.test(directImdbId);
          return idOk || imdbOk;
        });

        if (candidates.length) {
          const fetched = await runWithConcurrency(candidates, 12, async (m) => {
            const directImdbId = String((m as any)?.imdbId || "").trim();
            const imdbId = /^tt\d+$/i.test(directImdbId) ? directImdbId : (m.id > 0 ? (tmdbToImdb.get(m.id) || "") : "");
            if (!/^tt\d+$/i.test(String(imdbId || "").trim())) return { id: m.id, overview: "" };
            const overview = String((await getPlotByImdbId(String(imdbId))) || "").trim();
            return { id: m.id, overview };
          });

          const byId = new Map<number, string>();
          fetched.forEach((x) => {
            if (x && Number.isFinite(x.id) && String(x.overview || "").trim()) {
              byId.set(x.id, x.overview);
              filledLocalOverviewIds.add(x.id);
            }
          });

          if (byId.size && !cancelled) {
            setResults((prev) =>
              prev.map((m) => {
                const nextOverview = byId.get(m.id);
                if (!nextOverview) return m;
                if (m.overview === nextOverview) return m;
                return { ...m, overview: nextOverview };
              })
            );

            setTopRated((prev) =>
              prev.map((m) => {
                const nextOverview = byId.get(m.id);
                if (!nextOverview) return m;
                if ((m as any).overview === nextOverview) return m;
                return { ...(m as any), overview: nextOverview };
              }) as any
            );
          }
        }
      } catch {
        // ignore
      }

      // 0.75) Fill vote_average from local ratings (works without TMDb key).
      // note: Non-blocking for initial render; only patches missing values.
      try {
        const tmdbToImdb = await loadMedia1000ImdbByTmdbId();

        const candidates = [...results, ...topRated].filter((m) => {
          const hasNumericVote = typeof (m as any).vote_average === "number" && Number.isFinite((m as any).vote_average);
          if (hasNumericVote) return false;

          const idOk = Number.isFinite(m.id) && m.id > 0;
          const directImdbId = String((m as any)?.imdbId || "").trim();
          const imdbOk = /^tt\d+$/i.test(directImdbId);
          return idOk || imdbOk;
        });

        if (candidates.length) {
          const fetched = await runWithConcurrency(candidates, 12, async (m) => {
            const tmdbId = Number.isFinite(m.id) && m.id > 0 ? m.id : undefined;
            const directImdbId = String((m as any)?.imdbId || "").trim();
            const imdbId = /^tt\d+$/i.test(directImdbId) ? directImdbId : (tmdbId ? (tmdbToImdb.get(tmdbId) || "") : "");

            const fromTmdbId = tmdbId ? await getRatingByTmdbId(tmdbId) : undefined;
            const fromImdbId = imdbId ? await getRatingByImdbId(imdbId) : undefined;
            const rating = typeof fromTmdbId === "number" ? fromTmdbId : fromImdbId;

            return { id: m.id, vote_average: typeof rating === "number" && Number.isFinite(rating) ? rating : undefined };
          });

          if (!cancelled) {
            const byId = new Map<number, number>();
            fetched.forEach((x) => {
              if (!x || !Number.isFinite(x.id)) return;
              if (typeof x.vote_average !== "number" || !Number.isFinite(x.vote_average)) return;
              byId.set(x.id, x.vote_average);
            });

            if (byId.size) {
              setResults((prev) =>
                prev.map((m) => {
                  if (typeof m.vote_average === "number" && Number.isFinite(m.vote_average)) return m;
                  const v = byId.get(m.id);
                  if (typeof v !== "number") return m;
                  return { ...m, vote_average: v };
                })
              );

              setTopRated((prev) =>
                prev.map((m) => {
                  const cur = (m as any).vote_average;
                  if (typeof cur === "number" && Number.isFinite(cur)) return m;
                  const v = byId.get(m.id);
                  if (typeof v !== "number") return m;
                  return { ...(m as any), vote_average: v };
                }) as any
              );
            }
          }
        }
      } catch {
        // ignore
      }

      const needResults = results
        .filter((m) => Number.isFinite(m.id) && m.id > 0)
        .filter((m) => {
          const needsOverview = !String(m.overview || "").trim() && !filledLocalOverviewIds.has(m.id);
          const needsTagline = !String(m.tagline || "").trim();
          const needsVoteAverage = !(typeof m.vote_average === "number" && Number.isFinite(m.vote_average));
          return needsOverview || needsTagline || needsVoteAverage;
        })
        .filter((m) => !requestedDetailsIdsRef.current.has(m.id));

      const needTopRated = topRated
        .filter((m) => Number.isFinite(m.id) && m.id > 0)
        .filter((m) => {
          const needsTagline = !String(m.tagline || "").trim();
          const needsVoteAverage = !(typeof (m as any).vote_average === "number" && Number.isFinite((m as any).vote_average));
          return needsTagline || needsVoteAverage;
        })
        .filter((m) => !requestedDetailsIdsRef.current.has(m.id));

      const need = [...needResults, ...needTopRated];
      if (!need.length) return;

      need.forEach((m) => requestedDetailsIdsRef.current.add(m.id));

      // 1) Fetch details (bounded concurrency). Higher than 4 to reduce perceived wait.
      const fetched = await runWithConcurrency(need, 8, async (m) => {
        try {
          const d = await tmdbGetMovieDetails(m.id, { language: "en-US" });
          return {
            id: m.id,
            overview: String(d?.overview || "").trim(),
            tagline: String(d?.tagline || "").trim(),
            original_language: String(d?.original_language || "").trim(),
            vote_average: typeof d?.vote_average === 'number' && Number.isFinite(d.vote_average) ? d.vote_average : undefined,
          };
        } catch {
          return { id: m.id, overview: "", tagline: "", original_language: "", vote_average: undefined };
        }
      });

      if (cancelled) return;

      const byId = new Map<number, { overview: string; tagline: string; original_language: string; vote_average?: number }>();
      fetched.forEach((x) => {
        if (x && Number.isFinite(x.id)) {
          byId.set(x.id, {
            overview: x.overview || "",
            tagline: x.tagline || "",
            original_language: x.original_language || "",
            vote_average: typeof x.vote_average === 'number' ? x.vote_average : undefined,
          });
          // Mark resolved even if empty (prevents infinite "Loading plot…")
          resolvedDetailsIdsRef.current.add(x.id);

          // Persist to sessionStorage for instant future loads
          try {
            sessionStorage.setItem(
              detailsCacheKey(x.id),
              JSON.stringify({
                overview: x.overview || "",
                tagline: x.tagline || "",
                original_language: x.original_language || "",
                vote_average: typeof x.vote_average === 'number' ? x.vote_average : undefined,
              })
            );
          } catch {
            // ignore
          }
        }
      });

      setResults((prev) =>
        prev.map((m) => {
          const next = byId.get(m.id);
          if (!next) return m;
          return {
            ...m,
            overview: String(m.overview || "").trim() ? m.overview : next.overview,
            tagline: m.tagline || next.tagline,
            original_language: m.original_language || next.original_language,
            vote_average: typeof m.vote_average === 'number' ? m.vote_average : next.vote_average,
          };
        })
      );

      setTopRated((prev) =>
        prev.map((m) => {
          const next = byId.get(m.id);
          if (!next) return m;
          if (String(m.tagline || "").trim()) return m;
          return { ...m, tagline: next.tagline || m.tagline };
        })
      );
    }

    enrichCards();
    return () => {
      cancelled = true;
    };
  }, [results, topRated]);

  // note: Keep input in sync with URL (when user navigates with browser back/forward)
  useEffect(() => {
    const nextQ = String(searchParams.get("q") || "").trim();
    if (nextQ && nextQ !== query) setQuery(nextQ);
    if (!nextQ && query) {
      // note: If URL cleared, don't force-clear user input.
    }
  }, [searchParams, query]);

  const subtitle = useMemo(() => {
    if (!String(initialQuery || query).trim()) return "";
    return results.length ? `${results.length} ${results.length === 1 ? "movie" : "movies"}` : "No results yet";
  }, [results.length, query, initialQuery]);

  // Default to showing all results; some backends may not always provide trailer/plot.
  const [showAllResults, setShowAllResults] = useState(true);

  const filteredResults = useMemo(() => {
    if (showAllResults) return results;
    return results.filter((m) => {
      const hasTrailer = Boolean((m as any).trailerUrl || ((m as any).trailers && (m as any).trailers.length));
      const overviewText = String(m.overview || "").trim();
      return hasTrailer && overviewText;
    });
  }, [results, showAllResults]);

  const filteredTopRated = useMemo(() => {
    if (showAllResults) return topRated;
    return topRated.filter((m) => {
      const hasTrailer = Boolean((m as any).trailerUrl || ((m as any).trailers && (m as any).trailers.length));
      const overviewText = String(m.overview || "").trim();
      return hasTrailer && overviewText;
    });
  }, [topRated, showAllResults]);

  const pageBg = "var(--brand-900)";
  const ink = "var(--text-invert)";
  const muted = "var(--surface-muted)";
  const star = "★";

  return (
    <>
      <Navbar
        query={query}
        setQuery={setQuery}
        onRecommend={(nextResults: MovieRecommendation[], usedQuery?: string) => {
          const q = String(usedQuery || query || "").trim();
          setResults(nextResults);
          if (q) setSearchParams({ q });
        }}
      />

      <div style={{ backgroundColor: pageBg }}>
        <Container style={{ paddingTop: 36, paddingBottom: 72 }}>
          {results.length > 0 ? (
            <SectionHeader
              title={query.trim() ? `Search results: ${query.trim()}` : ""}
              subtitle={subtitle}
            />
          ) : null}

          {results.length === 0 ? (
            <div style={{ marginTop: 18 }}>
                <SectionHeader
                  title="Popular recommendations"
                  subtitle="Top-rated movies (10)"
                />

                {topRatedError ? (
                  <div style={{ textAlign: "center", padding: "18px 12px", color: muted, lineHeight: 1.6 }}>
                    {topRatedError}
                  </div>
                ) : topRatedLoading ? (
                  <div style={{ textAlign: "center", padding: "18px 12px", color: muted, lineHeight: 1.6 }}>
                    Loading recommendations…
                  </div>
                ) : topRated.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "18px 12px", color: muted, lineHeight: 1.6 }}>
                    No recommendations available.
                  </div>
                  ) : (
                  <div className={styles.movieGrid}>
                    {filteredTopRated.map((m) => {
                      const posterSrc = (m as any).posterUrl
                        ? String((m as any).posterUrl)
                        : m.poster_path
                          ? tmdbImage(m.poster_path, "w342")
                          : "";
                      const overviewText = String(m.overview || "").trim();
                      const year = m.release_date ? m.release_date.slice(0, 4) : "";
                      const _voteFromState = typeof m.vote_average === "number" && Number.isFinite(m.vote_average) ? m.vote_average : undefined;
                      let _voteFallback: number | undefined = undefined;
                      try {
                        const raw = sessionStorage.getItem(detailsCacheKey(m.id));
                        if (raw) {
                          const parsed = JSON.parse(raw);
                          if (parsed && typeof parsed.vote_average === 'number' && Number.isFinite(parsed.vote_average)) {
                            _voteFallback = parsed.vote_average;
                          }
                        }
                      } catch {
                        /* ignore */
                      }
                      const voteVal = typeof _voteFromState === 'number' ? _voteFromState : _voteFallback;
                      const rating = typeof voteVal === "number" && Number.isFinite(voteVal) ? voteVal.toFixed(1) : "—";
                      const intro = shortIntro(m.tagline, overviewText);

                      const hasId = Number.isFinite(m.id) && m.id > 0;
                      const fav = hasId ? isFavorite(m.id) : false;

                      return (
                        <div
                          key={String((m as any).imdbId || m.id)}
                          onClick={() => {
                            if (hasId) navigate(`/movie/${m.id}`);
                          }}
                          className={styles.movieCard}
                          style={{ cursor: hasId ? "pointer" : "default" }}
                          title={m.title}
                        >
                          {hasId ? (
                            <button
                              type="button"
                              className={`${styles.favBtn}${fav ? ` ${styles.favBtnActive}` : ""}`}
                              aria-label={fav ? "Remove from My List" : "Add to My List"}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!user) {
                                  navigate("/my-list");
                                  return;
                                }
                                toggleFavorite({
                                  tmdbId: m.id,
                                  title: String(m.title || "").trim() || `Movie ${m.id}`,
                                  year,
                                  posterUrl: posterSrc,
                                });
                              }}
                            >
                              {fav ? <FavoriteRoundedIcon /> : <FavoriteBorderRoundedIcon />}
                            </button>
                          ) : null}

                          <div className={styles.poster} style={{ background: "var(--surface-muted)" }}>
                            <div className={styles.posterPlaceholder}>
                              <span className={styles.posterPlaceholderTitle}>{m.title || "No poster"}</span>
                            </div>
                            {posterSrc ? (
                              <img
                                src={posterSrc}
                                alt={m.title}
                                style={{ width: "100%", height: "100%", objectFit: "cover", position: "relative", zIndex: 1, display: "block" }}
                                onError={(e) => {
                                  e.currentTarget.style.display = "none";
                                }}
                              />
                            ) : null}
                          </div>
                            <div className={styles.meta}>
                              <div className={styles.title} style={{ color: ink }}>
                              {m.title}{year ? ` (${year})` : ""}
                            </div>
                            <div className={styles.rating} style={{ color: ink }}>
                              <div className={styles.ratingNum}>{rating}</div>
                              <div className={styles.ratingStar}>{star}</div>
                            </div>
                            <div className={styles.submeta}>
                              {year ? <span className={styles.metaPart}>{year}</span> : null}
                              {year && m.original_language ? <span className={styles.metaSep}>|</span> : null}
                              {m.original_language ? <span className={styles.metaPart}>{String(m.original_language).toUpperCase()}</span> : null}
                              {(year || m.original_language) && intro ? <span className={styles.metaSep}>|</span> : null}
                              {intro ? <span className={styles.tagline}>{intro}</span> : null}
                            </div>
                            <div className={styles.divider} />
                            <div className={styles.overview} style={{ color: "var(--text-invert)" }}>
                              {overviewText || "Plot unavailable."}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
          ) : (
            <div>
              {filteredResults.length === 0 && results.length > 0 && !showAllResults ? (
                <div style={{ textAlign: "center", padding: "18px 12px", color: muted, lineHeight: 1.6 }}>
                  {`Found ${results.length} ${results.length === 1 ? "movie" : "movies"}, but none have a trailer or plot.`}
                  <div style={{ marginTop: 12 }}>
                    <button type="button" onClick={() => setShowAllResults(true)} style={{ padding: "8px 12px", borderRadius: 6, cursor: "pointer" }}>Show all results</button>
                  </div>
                </div>
              ) : null}

              <div className={styles.movieGrid}>
              {filteredResults.map((m) => {
                const hasId = Number.isFinite(m.id) && m.id > 0;
                const posterSrc = m.posterUrl
                  ? m.posterUrl
                  : m.poster_path
                    ? tmdbImage(m.poster_path, "w342")
                    : "";
                const overviewText = String(m.overview || "").trim();

                const year = m.release_date ? m.release_date.slice(0, 4) : "";
                const _voteFromState = typeof m.vote_average === "number" && Number.isFinite(m.vote_average) ? m.vote_average : undefined;
                let _voteFallback: number | undefined = undefined;
                try {
                  const raw = sessionStorage.getItem(detailsCacheKey(m.id));
                  if (raw) {
                    const parsed = JSON.parse(raw);
                    if (parsed && typeof parsed.vote_average === 'number' && Number.isFinite(parsed.vote_average)) {
                      _voteFallback = parsed.vote_average;
                    }
                  }
                } catch {
                  /* ignore */
                }
                const voteVal = typeof _voteFromState === 'number' ? _voteFromState : _voteFallback;
                const rating = typeof voteVal === "number" && Number.isFinite(voteVal) ? voteVal.toFixed(1) : "—";

                const intro = shortIntro(m.tagline, overviewText);

                const isPlotResolved = resolvedDetailsIdsRef.current.has(m.id);
                const hasFavId = Number.isFinite(m.id) && m.id > 0;
                const fav = hasFavId ? isFavorite(m.id) : false;

                return (
                  <div
                    key={`${m.id}|${String((m as any).imdbId || '')}|${m.title}|${m.release_date || ''}`}
                    onClick={() => {
                      if (hasId) navigate(`/movie/${m.id}`);
                    }}
                    className={styles.movieCard}
                    style={{ cursor: hasId ? "pointer" : "default" }}
                    title={m.title}
                  >
                    {hasFavId ? (
                      <button
                        type="button"
                        className={`${styles.favBtn}${fav ? ` ${styles.favBtnActive}` : ""}`}
                        aria-label={fav ? "Remove from My List" : "Add to My List"}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!user) {
                            navigate("/my-list");
                            return;
                          }
                          toggleFavorite({
                            tmdbId: m.id,
                            title: String(m.title || "").trim() || `Movie ${m.id}`,
                            year,
                            posterUrl: posterSrc,
                          });
                        }}
                      >
                        {fav ? <FavoriteRoundedIcon /> : <FavoriteBorderRoundedIcon />}
                      </button>
                    ) : null}

                    <div className={styles.poster} style={{ background: "var(--surface-muted)" }}>
                      <div className={styles.posterPlaceholder}>
                        <span className={styles.posterPlaceholderTitle}>{m.title || "No poster"}</span>
                      </div>
                      {posterSrc ? (
                        <img
                          src={posterSrc}
                          alt={m.title}
                          style={{ width: "100%", height: "100%", objectFit: "cover", position: "relative", zIndex: 1, display: "block" }}
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                          }}
                        />
                      ) : null}
                    </div>
                      <div className={styles.meta}>
                        <div
                          className={styles.title}
                          style={{ color: ink }}
                        >
                          {m.title}{year ? ` (${year})` : ""}
                        </div>
                        <div className={styles.rating} style={{ color: ink }}>
                          <div className={styles.ratingNum}>{rating}</div>
                          <div className={styles.ratingStar}>{star}</div>
                        </div>
                        <div className={styles.submeta}>
                          {year ? <span className={styles.metaPart}>{year}</span> : null}
                          {year && m.original_language ? <span className={styles.metaSep}>|</span> : null}
                          {m.original_language ? <span className={styles.metaPart}>{String(m.original_language).toUpperCase()}</span> : null}
                          {(year || m.original_language) && intro ? <span className={styles.metaSep}>|</span> : null}
                          {intro ? <span className={styles.tagline}>{intro}</span> : null}
                        </div>

                      <div className={styles.divider} />

                      <div className={styles.overview} style={{ color: "var(--text-invert)" }}>
                        {overviewText
                          ? overviewText
                          : hasId && !isPlotResolved
                            ? "Loading plot…"
                            : "Plot unavailable."}
                      </div>
                    </div>
                  </div>
                );
              })}
                </div>
            </div>
          )}

        </Container>
      </div>

      <Footer />
    </>
  );
}

function Container({
  children,
  style = {},
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        width: "100%",
        /* Allow wider content so grids can spread on large screens */
        maxWidth: 1600,
        margin: "0 auto",
        padding: "0 28px",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  if (!title && !subtitle) return null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        marginBottom: 20,
        gap: 14,
      }}
    >
      <div style={{ minWidth: 0 }}>
        {title ? (
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "var(--text-invert)", letterSpacing: "-0.02em" }}>
            {title}
          </h2>
        ) : null}
        {subtitle ? <p style={{ margin: "8px 0 0", color: "var(--surface-muted)", fontSize: 13 }}>{subtitle}</p> : null}
      </div>
    </div>
  );
}
