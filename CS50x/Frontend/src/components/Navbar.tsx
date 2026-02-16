// src/components/Navbar.tsx ?
import { Link } from "react-router-dom";

import { useEffect, useMemo, useRef, useState, Dispatch, SetStateAction } from "react";
import { MovieRecommendation } from "../utils/recommendMovies";
import { tmdbFindByImdbId, tmdbGetMovieDetails, tmdbSearchMovies } from "../utils/tmdb";
import { getSearchApiBaseUrl } from "../utils/searchApiBase";
import { useAuth } from "../auth/AuthContext";

import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";

import FavoriteBorderRoundedIcon from "@mui/icons-material/FavoriteBorderRounded";
import VisibilityRoundedIcon from "@mui/icons-material/VisibilityRounded";
import VisibilityOffRoundedIcon from "@mui/icons-material/VisibilityOffRounded";

import styles from "./Navbar.module.css";

type LocalMediaTopItem = {
  imdbId: string;
  title?: string;
  posterUrl?: string | null;
  trailers?: Array<{ url?: string; name?: string; site?: string; type?: string; key?: string }>;
};

type Media1000Item = {
  tmdbId: number;
  imdbId?: string | null;
  title?: string | null;
  year?: string | null;
  posterUrl?: string | null;
  trailers?: Array<{ url?: string; name?: string; site?: string; type?: string; key?: string }>;
};

type Media1000Index = {
  byTmdbId: Map<number, Media1000Item>;
  byImdbId: Map<string, Media1000Item>;
  byTitleYear: Map<string, Media1000Item>;
};

let localTopMediaPromise: Promise<Map<string, LocalMediaTopItem>> | null = null;

async function loadLocalTopMediaByImdbId(): Promise<Map<string, LocalMediaTopItem>> {
  if (localTopMediaPromise) return localTopMediaPromise;
  localTopMediaPromise = (async () => {
    try {
      const resp = await fetch('/media_top10.json', { cache: 'no-cache' });
      if (!resp.ok) return new Map();
      const data = await resp.json().catch(() => ({}));
      const items: LocalMediaTopItem[] = Array.isArray(data?.items) ? data.items : [];
      const map = new Map<string, LocalMediaTopItem>();
      for (const it of items) {
        const imdbId = String(it?.imdbId || '').trim();
        if (!imdbId) continue;
        map.set(imdbId, it);
      }
      return map;
    } catch {
      return new Map();
    }
  })();
  return localTopMediaPromise;
}

let media1000Promise: Promise<Media1000Index> | null = null;

async function loadMedia1000Index(): Promise<Media1000Index> {
  media1000Promise = (async () => {
    try {
      const resp = await fetch('/media_1000.json', { cache: 'no-cache' });
      if (!resp.ok) return { byTmdbId: new Map(), byImdbId: new Map(), byTitleYear: new Map() };
      const data = await resp.json().catch(() => ({}));

      const rawByTmdbId = (data?.byTmdbId && typeof data.byTmdbId === 'object') ? data.byTmdbId : {};
      const rawByImdbId = (data?.byImdbId && typeof data.byImdbId === 'object') ? data.byImdbId : {};

      const byTmdbId = new Map<number, Media1000Item>();
      const byImdbId = new Map<string, Media1000Item>();
      const byTitleYear = new Map<string, Media1000Item>();

      const keyTitleYear = (title: any, year: any) => {
        const t = String(title || '').trim().toLowerCase();
        const y = String(year || '').trim().slice(0, 4);
        if (!t) return '';
        return `${t}|${y}`;
      };

      for (const [k, v] of Object.entries(rawByTmdbId)) {
        const tmdbId = Number(k);
        if (!Number.isFinite(tmdbId) || tmdbId <= 0) continue;
        const item = v as Media1000Item;
        byTmdbId.set(tmdbId, item);
        const imdbId = String((item as any)?.imdbId || '').trim();
        if (/^tt\d+$/i.test(imdbId) && !byImdbId.has(imdbId)) byImdbId.set(imdbId, item);

        const kty = keyTitleYear((item as any)?.title, (item as any)?.year);
        if (kty && !byTitleYear.has(kty)) byTitleYear.set(kty, item);
      }

      for (const [k, v] of Object.entries(rawByImdbId)) {
        const imdbId = String(k || '').trim();
        if (!/^tt\d+$/i.test(imdbId)) continue;
        if (!byImdbId.has(imdbId)) byImdbId.set(imdbId, v as Media1000Item);
      }

      return { byTmdbId, byImdbId, byTitleYear };
    } catch {
      return { byTmdbId: new Map(), byImdbId: new Map(), byTitleYear: new Map() };
    }
  })();
  return media1000Promise;
}




export interface NavbarProps {
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  onRecommend: (results: MovieRecommendation[], usedQuery?: string) => void;
}

export default function Navbar({ query, setQuery, onRecommend }: NavbarProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const { user } = useAuth();

  const aliveRef = useRef(true);
  const searchSeqRef = useRef(0);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "signup" | "confirm" | "forgot" | "reset">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authPassword2, setAuthPassword2] = useState("");
  const [authCode, setAuthCode] = useState("");
  const [authError, setAuthError] = useState<string>("");
  const [authInfo, setAuthInfo] = useState<string>("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authShowPassword, setAuthShowPassword] = useState(false);

  const auth = useAuth();

  // Profile popup state (show user profile inline, not navigate)
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLButtonElement | null>(null);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);

  const displayName = useMemo(() => {
    const nameRaw = String((user as any)?.name || '').trim();
    if (nameRaw) return nameRaw;
    const email = String(user?.email || '').trim();
    if (!email) return 'Member';
    return email.split('@')[0] || 'Member';
  }, [user]);

  // Close profile popup when clicking outside
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const el = e.target as Node | null;
      if (!profileOpen) return;
      if (el && profileRef.current?.contains(el)) return;
      if (el && profileMenuRef.current?.contains(el)) return;
      setProfileOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (!profileOpen) return;
      if (e.key === 'Escape') setProfileOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [profileOpen]);
  const authTitle = useMemo(() => {
    if (authMode === "confirm") return "Confirm email";
    if (authMode === "forgot") return "Forgot password";
    if (authMode === "reset") return "Reset password";
    return authMode === "login" ? "Login" : "Sign up";
  }, [authMode]);
  // Local input state to avoid parent-driven value stomping while typing ?
  const [localQuery, setLocalQuery] = useState<string>(query || "");

  // Track input focus to avoid overwriting while the user is typing.
  const [isFocused, setIsFocused] = useState(false);

  // When user clicks Search, the input will blur before parent `query` updates.
  // Use a short-lived flag to ignore the next sync so we don't stomp in-progress input.
  const ignoreNextSyncRef = useRef(false);

  // Keep localQuery in sync when parent updates `query` from outside,
  // but don't stomp on in-progress edits (when input is focused).
  useEffect(() => {
    if (isFocused) return;
    if (ignoreNextSyncRef.current) {
      // consume the flag and skip this immediate sync
      ignoreNextSyncRef.current = false;
      return;
    }
    setLocalQuery(query || "");
  }, [query, isFocused]);

  // Per-session cache for enrichment results (reduces repeated TMDb calls) ?
  const enrichmentCache = (globalThis as any).__POP_ENRICH_CACHE__
    || ((globalThis as any).__POP_ENRICH_CACHE__ = new Map<
      string,
      { id: number; poster_path: string | null; overview?: string; vote_average?: number }
    >());

  function stableNegativeIdFromImdbId(imdbId: string): number {
    // Deterministic, stable, and very unlikely to collide for our list sizes. ?
    // Keeps UI working even when backend doesn't provide tmdbId and TMDb enrichment is unavailable. ?
    const s = String(imdbId || '').trim();
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
      hash = (hash * 31 + s.charCodeAt(i)) | 0;
    }
    // Ensure non-zero negative. ?
    const n = Math.abs(hash) || 1;
    return -n;
  }

  async function enrichWithPosterAndTmdbId(
    items: Array<{
      title?: string;
      year?: string | number;
      tmdbId?: number | string;
      imdbId?: string;
      poster_path?: string | null;
    }>,
    opts?: { language?: string }
  ): Promise<Array<{ id: number; poster_path: string | null }>> {
    const language = opts?.language ?? "en-US";

    const runWithConcurrency = async <T, R>(arr: T[], limit: number, worker: (v: T) => Promise<R>) => {
      const results: R[] = new Array(arr.length);
      let nextIndex = 0;
      const runners = new Array(Math.max(1, limit)).fill(0).map(async () => {
        while (nextIndex < arr.length) {
          const i = nextIndex++;
          results[i] = await worker(arr[i]);
        }
      });
      await Promise.all(runners);
      return results;
    };

    const enriched = await runWithConcurrency(items, 4, async (r) => {
      const cacheKey = (() => {
        const imdbId = String(r?.imdbId || '').trim().toLowerCase();
        const title = String(r?.title || '').trim().toLowerCase();
        const year = String(r?.year || '').slice(0, 4);
        if (imdbId) return `imdb:${imdbId}`;
        return `ty:${title}|${year}`;
      })();
      const cached = enrichmentCache.get(cacheKey);
      if (cached) return cached;

      // 1) Already has TMDb id (best) ?
      const tmdbIdRaw = r?.tmdbId;
      const tmdbId = typeof tmdbIdRaw === "number" ? tmdbIdRaw : Number(tmdbIdRaw);
      if (Number.isFinite(tmdbId) && tmdbId > 0) {
        if (r?.poster_path) {
          const v: any = { id: tmdbId, poster_path: r.poster_path };
          enrichmentCache.set(cacheKey, v);
          return v;
        }
        try {
          const d = await tmdbGetMovieDetails(tmdbId, { language });
          const v: any = { id: tmdbId, poster_path: d?.poster_path ?? null };
          v.overview = String(d?.overview || "").trim() || undefined;
          v.vote_average = typeof d?.vote_average === 'number' && Number.isFinite(d.vote_average) ? d.vote_average : undefined;
          enrichmentCache.set(cacheKey, v);
          return v;
        } catch {
          const v = { id: tmdbId, poster_path: null };
          enrichmentCache.set(cacheKey, v);
          return v;
        }
      }

      // 2) IMDb id —> TMDb /find ?
      const imdbId = String(r?.imdbId || "").trim();
      if (/^tt\d+$/i.test(imdbId)) {
        try {
          const found = await tmdbFindByImdbId(imdbId, { language });
          const first = found?.movie_results?.[0];
          if (first?.id) {
            const v: any = { id: first.id, poster_path: first.poster_path ?? null };
            // Use overview/rating directly from /find (no extra network call)
            v.overview = String((first as any)?.overview || "").trim() || undefined;
            v.vote_average = typeof (first as any)?.vote_average === 'number' && Number.isFinite((first as any).vote_average)
              ? (first as any).vote_average
              : undefined;
            enrichmentCache.set(cacheKey, v);
            return v;
          }
        } catch {
          // 說明：ignore and fallback
        }
      }

      // 提醒：3) Title (+year) search fallback
      const title = String(r?.title || "").trim();
      if (!title) {
        return { id: -1, poster_path: null };
      }

      const y = r?.year;
      const yearNum = typeof y === "number" ? y : Number(String(y || "").slice(0, 4));
      try {
        const sr = await tmdbSearchMovies(title, {
          language,
          page: 1,
          include_adult: false,
          year: Number.isFinite(yearNum) ? yearNum : undefined,
        });
        const first = sr?.results?.[0];
        if (first?.id) {
          const v: any = { id: first.id, poster_path: first.poster_path ?? null };
          // Use overview/rating directly from /search result (no extra network call)
          v.overview = String(first.overview || "").trim() || undefined;
          v.vote_average = typeof first.vote_average === 'number' && Number.isFinite(first.vote_average) ? first.vote_average : undefined;
          enrichmentCache.set(cacheKey, v);
          return v;
        }
      } catch {
        // 備註：ignore
      }

      const v = { id: -1, poster_path: null };
      enrichmentCache.set(cacheKey, v);
      return v;
    });

    return enriched;
  }

  // 小提醒：Semantic search API

  const handleSearch = async () => {
    const mySeq = ++searchSeqRef.current;
    const q = String(localQuery || '').trim();
    // Update parent query state when a search is triggered
    try {
      // Prevent the blur-driven sync from stomping the just-typed localQuery
      try { ignoreNextSyncRef.current = true; } catch {}
      setQuery(q);
    } catch {
      // ignore
    }
    if (!q) return;
    setLoading(true);
    setError("");
    try {
      const apiBaseUrl = getSearchApiBaseUrl();
      if (!apiBaseUrl) {
        setError('API URL is not configured. Set REACT_APP_RELIVRE_API_URL in .env.local');
        onRecommend([], q);
        setLoading(false);
        return;
      }

      // Add a hard timeout so a stalled backend request can't freeze the UI for minutes.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20_000);
      const resp = await fetch(`${apiBaseUrl}search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: q, topK: 12 }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(String(data?.error || `HTTP ${resp.status}`));
      }
      // 註：Convert to UI shape
      const rawResults: any[] = Array.isArray(data?.results) ? data.results : [];

      // 註：Local downloaded media (1000) index (primary)
      const media1000 = await loadMedia1000Index();
      // 小提醒：Legacy top10 manifest (fallback)
      const localTop10ByImdbId = await loadLocalTopMediaByImdbId();

      const baseList = rawResults.map((r: any) => {
        const title = String(r?.title || "").trim();
        const overview = String(r?.overview || r?.plot || r?.description || r?.summary || "").trim();
        const tagline = String(r?.tagline || "").trim();
        const year = r?.year;
        const release_date = typeof year === "string" || typeof year === "number" ? String(year) : "";
        const imdbId = String(r?.imdbId || "").trim();
        const tmdbIdNum = typeof r?.tmdbId === "number" ? r.tmdbId : Number(r?.tmdbId);
        const hasTmdbId = Number.isFinite(tmdbIdNum) && tmdbIdNum > 0;

        const titleYearKey = `${title.toLowerCase()}|${String(year || '').slice(0, 4)}`;
        const mediaItem =
          (hasTmdbId ? media1000.byTmdbId.get(tmdbIdNum) : undefined)
          || (imdbId ? media1000.byImdbId.get(imdbId) : undefined);
        const mediaItemByTitleYear = (!mediaItem && title) ? media1000.byTitleYear.get(titleYearKey) : undefined;
        const top10Item = imdbId ? localTop10ByImdbId.get(imdbId) : undefined;

        const posterUrl = ((mediaItem?.posterUrl ?? mediaItemByTitleYear?.posterUrl) ?? top10Item?.posterUrl ?? null) as string | null;
        const trailers = Array.isArray(mediaItem?.trailers)
          ? (mediaItem!.trailers as any[])
          : Array.isArray(mediaItemByTitleYear?.trailers)
            ? (mediaItemByTitleYear!.trailers as any[])
          : Array.isArray(top10Item?.trailers)
            ? (top10Item!.trailers as any[])
            : [];
        const toUrlFromKey = (t: any): string => {
          const site = String(t?.site || '').trim().toLowerCase();
          const key = String(t?.key || '').trim();
          if (!key) return '';
          if (site === 'youtube') return `https://youtu.be/${key}`;
          if (site === 'vimeo') return `https://vimeo.com/${key}`;
          return '';
        };
        const pick = (pred: (t: any) => boolean): any | undefined => trailers.find((t) => pred(t));
        const bestTrailerUrl =
          ((pick((t) => (t?.url || t?.key) && String(t?.type).toLowerCase() === 'trailer')?.url ||
            toUrlFromKey(pick((t) => (t?.url || t?.key) && String(t?.type).toLowerCase() === 'trailer')) ||
            pick((t) => (t?.url || t?.key) && String(t?.type).toLowerCase() === 'teaser')?.url ||
            toUrlFromKey(pick((t) => (t?.url || t?.key) && String(t?.type).toLowerCase() === 'teaser')) ||
            pick((t) => t?.url || t?.key)?.url ||
            toUrlFromKey(pick((t) => t?.url || t?.key)) ||
            null) as string | null);
        const trailerUrl = bestTrailerUrl;

        const derivedTmdbId = Number((mediaItem as any)?.tmdbId ?? (mediaItemByTitleYear as any)?.tmdbId);
        const usableTmdbId = hasTmdbId
          ? tmdbIdNum
          : (Number.isFinite(derivedTmdbId) && derivedTmdbId > 0 ? derivedTmdbId : NaN);
        const vote_average = typeof r?.vote_average === 'number' && Number.isFinite(r.vote_average) ? r.vote_average : undefined;

        return {
          // 備註：Prefer tmdbId if backend provides it; otherwise keep placeholder until enrichment fills it.
          id: Number.isFinite(usableTmdbId) && usableTmdbId > 0
            ? usableTmdbId
            : stableNegativeIdFromImdbId(imdbId || title),
          title,
          overview: overview || undefined,
          tagline: tagline || undefined,
          // include genre/mood data from backend (used for light heuristic re-ranking)
          genre: typeof r?.genre === 'string' ? r.genre : undefined,
          moodTags: Array.isArray(r?.moodTags) ? r.moodTags : undefined,
          vote_average: vote_average,
          release_date,
          poster_path: (typeof r?.poster_path === "string" ? r.poster_path : null) as string | null,
          imdbId: imdbId || undefined,
          posterUrl,
          trailerUrl,
          _imdbId: imdbId,
          _tmdbId: r?.tmdbId ?? (Number.isFinite(usableTmdbId) ? usableTmdbId : undefined),
          _year: year,
        };
      });

      // Simple client-side re-ranking heuristic:
      // If user query contains explicit genre/mood keywords (e.g. "喜劇", "comedy", "輕鬆"),
      // boost results whose `genre` or `moodTags` match those keywords.
      try {
        const qLower = String(q || "").toLowerCase();
        const wantsComedy = /(?:喜\u5287|喜剧|喜劇|\bcomedy\b)/i.test(qLower);
        const wantsLight = /(?:輕鬆|放鬆|輕快|輕鬆的|light)/i.test(qLower);
        if (wantsComedy || wantsLight) {
          baseList.sort((a, b) => {
            const scoreFor = (it: any) => {
              let s = 0;
              const genre = String(it?.genre || "").toLowerCase();
              const moods = (Array.isArray(it?.moodTags) ? it.moodTags.join(' ').toLowerCase() : '');
              if (wantsComedy && genre.includes('comedy')) s += 100;
              if (wantsComedy && moods.includes('comedy')) s += 80;
              if (wantsLight && /uplift|uplifting|light|funny|humor|humour|funny/.test(moods + ' ' + genre)) s += 60;
              return s;
            };
            return scoreFor(b) - scoreFor(a);
          });
        }
      } catch {
        // best-effort; ignore any re-rank errors
      }

      // 1) Return results immediately (fast UI), even if posters/ids need enrichment.
      const listNow: MovieRecommendation[] = baseList
        .filter((m) => Boolean(m.title && m.trailerUrl))
        .map(({ _imdbId, _tmdbId, _year, ...m }) => m);
      onRecommend(listNow, q);
      setLoading(false);

      // 2) Enrich in the background; only apply if this Navbar instance is still mounted
      // and this is still the latest search.
      void (async () => {
        try {
          const need = baseList
            .filter((m) => !(Number.isFinite(m.id) && m.id > 0) || !m.poster_path)
            .map((m) => ({
              title: m.title,
              year: m._year,
              tmdbId: m._tmdbId,
              imdbId: m._imdbId,
              poster_path: m.poster_path,
            }));

          if (!need.length) return;

          const enriched = await enrichWithPosterAndTmdbId(need, { language: "en-US" });
          const byTitleYear = new Map<string, { id: number; poster_path: string | null }>();
          for (let i = 0; i < need.length; i++) {
            const k = `${String(need[i].title || "").toLowerCase()}|${String(need[i].year || "").slice(0, 4)}`;
            if (enriched[i]) byTitleYear.set(k, enriched[i]);
          }

          for (const m of baseList) {
            const k = `${String(m.title || "").toLowerCase()}|${String(m._year || "").slice(0, 4)}`;
            const e = byTitleYear.get(k);
            if (e) {
              if (!(Number.isFinite(m.id) && m.id > 0)) m.id = e.id;
              if (!m.poster_path) m.poster_path = e.poster_path;
              if (!m.overview && (e as any).overview) m.overview = (e as any).overview;
              if (typeof (e as any).vote_average === 'number' && m.vote_average === undefined) m.vote_average = (e as any).vote_average;
            }
          }

          if (!aliveRef.current) return;
          if (searchSeqRef.current !== mySeq) return;

          const listEnriched: MovieRecommendation[] = baseList
            .filter((m) => Boolean(m.title))
            .map(({ _imdbId, _tmdbId, _year, ...m }) => m);
          onRecommend(listEnriched, q);
        } catch {
          // Best-effort only; keep already-shown results.
        }
      })();

      return;
    } catch (e: any) {
      const msg = String(e?.name || '').toLowerCase().includes('abort')
        ? 'Search timed out. Please try again.'
        : (e?.message ?? "Search failed");
      setError(msg);
      onRecommend([], q);
    }
    setLoading(false);
  };

  return (
    <header className={styles.appleNavbar}>
      <nav className={styles.navbarContent}>
        <div className={styles.navbarInner}>
          <div className={styles.logoArea}>
            <Link to="/" className={styles.logoLink} aria-label="Home">
              <img src="/image.png" alt="Popcorn" className={styles.logoImg} />
            </Link>
          </div>

          <div className={styles.searchOuter}>
            <div className={styles.searchBox}>
              <input
                type="text"
                placeholder="Describe the movie you want…"
                value={localQuery}
                onChange={(e) => {
                  setLocalQuery(e.target.value);
                }}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className={styles.searchInput}
              />
              <button
                onMouseDown={() => {
                  try {
                    ignoreNextSyncRef.current = true;
                  } catch {}
                }}
                onClick={handleSearch}
                disabled={loading}
                className={styles.searchButton}
              >
                {loading ? "Searching…" : "Search"}
              </button>
            </div>
          </div>

          {/* Right column intentionally left empty — login CTA is fixed */}
          <div className={styles.rightSpacer} />
        </div>
      </nav>

      {/* Fixed login/profile CTA at top-right */}
      <div className={styles.loginCta} aria-hidden={false}>
        <Link className={styles.loginPill} to="/my-list" aria-label="My Favorites">
          <FavoriteBorderRoundedIcon />
          <span className={styles.mylistLabel}>My Favorites</span>
        </Link>

        {user ? (
          <>
            <button
              ref={profileRef}
              className={`${styles.loginPill} ${styles.loginAvatar}`}
              title={user.email}
              onClick={() => {
                // Open inline profile popup instead of auth dialog
                setProfileOpen((v) => !v);
              }}
            >
              {((user as any)?.avatarUrl) ? (
                <img src={(user as any).avatarUrl} alt="avatar" className={styles.loginAvatarImg} />
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                  <circle cx="12" cy="8" r="3" stroke="currentColor" strokeWidth="1.2" />
                  <path d="M4 20c0-3.3137 2.6863-6 6-6h4c3.3137 0 6 2.6863 6 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
            {profileOpen ? (
              <div ref={profileMenuRef} className={styles.profileMenu} role="dialog" aria-label="Profile menu">
                <div className={styles.profileCard}>
                  <div className={styles.profileHeader}>
                    <div className={styles.profileAvatar} aria-hidden>
                      {((user as any)?.avatarUrl) ? (
                        <img src={(user as any).avatarUrl} alt="" />
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                          <circle cx="12" cy="8" r="3" stroke="currentColor" strokeWidth="1.2" />
                          <path d="M4 20c0-3.3137 2.6863-6 6-6h4c3.3137 0 6 2.6863 6 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>
                    <div className={styles.profileMeta}>
                      <div className={styles.profileName}>{displayName}</div>
                      <div className={styles.profileEmail}>{String(user?.email || '')}</div>
                    </div>
                  </div>

                  <div className={styles.profileDivider} />

                  <button
                    type="button"
                    className={`${styles.profileItem} ${styles.profileLogout}`}
                    onClick={async () => {
                      try {
                        await auth.logout();
                      } catch {
                        // ignore
                      } finally {
                        setProfileOpen(false);
                      }
                    }}
                  >
                    Log out
                  </button>
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <button
            className={styles.loginPill}
            onClick={() => {
              setAuthMode("login");
              setAuthError("");
              setAuthInfo("");
              setAuthCode("");
              setAuthPassword("");
              setAuthPassword2("");
              setAuthOpen(true);
            }}
            aria-label="Login"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
              <path d="M16 17l5-5-5-5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M21 12H9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M11 19H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className={styles.loginPillLabel}>Login</span>
          </button>
        )}
      </div>

      <Dialog
        open={authOpen}
        onClose={() => {
          if (authBusy) return;
          setAuthOpen(false);
        }}
        PaperProps={{
            sx: {
              backgroundColor: "var(--brand-900)",
              border: "1px solid var(--border-1)",
              borderRadius: 12,
              color: "var(--text-invert)",
              width: "min(700px, 94vw)",
              overflow: "hidden",
            },
        }}
      >
        <DialogContent sx={{ p: 0 }}>
          <div className={styles.authDialog}>
            <div className={`${styles.authRight} ${styles.authSingle}`}>
              <div className={styles.authHeader}>
                <div style={{ fontSize: 28, fontWeight: 900, color: "var(--text-invert)", letterSpacing: "-0.02em", lineHeight: 1.02 }}>{authTitle}</div>
                <div style={{ fontSize: 14, color: "rgba(255, 255, 255, 0.72)", marginTop: 6, marginBottom: 8 }}>
                  {authMode === "login"
                    ? "Enter your email and password"
                    : authMode === "signup"
                      ? "Create an account to get started"
                      : authMode === "confirm"
                        ? "Please enter the verification code sent to your email"
                        : authMode === "forgot"
                          ? "We'll email you a reset code"
                          : "Enter the reset code and choose a new password"}
                </div>
              </div>

              <div className={styles.authTabs}>
                <Button
                  variant={authMode === "login" ? "contained" : "outlined"}
                  onClick={() => {
                    if (authBusy) return;
                    setAuthMode("login");
                    setAuthError("");
                    setAuthInfo("");
                    setAuthCode("");
                  }}
                  sx={{
                    fontWeight: 900,
                    borderRadius: 999,
                    textTransform: "none",
                    backgroundColor: authMode === "login" ? "var(--accent-500)" : undefined,
                    color: authMode === "login" ? "var(--accent-contrast)" : "var(--accent-500)",
                    borderColor: "var(--accent-500)",
                    '&:hover': {
                      backgroundColor: authMode === "login" ? 'color-mix(in srgb, var(--accent-500) 85%, black 15%)' : 'color-mix(in srgb, var(--accent-500) 10%, transparent)'
                    }
                  }}
                  >
                  Login
                </Button>
                <Button
                  variant={authMode === "signup" ? "contained" : "outlined"}
                  onClick={() => {
                    if (authBusy) return;
                    setAuthMode("signup");
                    setAuthError("");
                    setAuthInfo("");
                    setAuthCode("");
                  }}
                  sx={{
                    fontWeight: 900,
                    borderRadius: 999,
                    textTransform: "none",
                    backgroundColor: authMode === "signup" ? "var(--accent-500)" : undefined,
                    color: authMode === "signup" ? "var(--accent-contrast)" : "var(--accent-500)",
                    borderColor: "var(--accent-500)",
                    '&:hover': {
                      backgroundColor: authMode === "signup" ? 'color-mix(in srgb, var(--accent-500) 85%, black 15%)' : 'color-mix(in srgb, var(--accent-500) 10%, transparent)'
                    }
                  }}
                >
                  Sign up
                </Button>
              </div>

              <Divider sx={{ my: 2, borderColor: "color-mix(in srgb, var(--text-invert) 12%, transparent)" }} />

              {authMode === "confirm" ? (
                <>
                  <div className={styles.authHint}>
                    We've sent a verification code to <span className={styles.authStrong}>{authEmail}</span>
                  </div>
                  <TextField
                    fullWidth
                    label="Verification code"
                    value={authCode}
                    onChange={(e) => setAuthCode(e.target.value)}
                    autoComplete="one-time-code"
                    size="small"
                    className={styles.authInput}
                    sx={{ mb: 1.0 }}
                    InputLabelProps={{ style: { color: "color-mix(in srgb, var(--text-invert) 72%, transparent)" } }}
                  />
                  <Button
                    variant="text"
                    disabled={authBusy || !authEmail.trim()}
                    onClick={async () => {
                      if (authBusy) return;
                      setAuthBusy(true);
                      setAuthError("");
                      setAuthInfo("");
                      try {
                        await auth.resend(authEmail);
                        setAuthInfo("Verification code resent.");
                      } catch (e: any) {
                        setAuthError(String(e?.message || "Resend failed"));
                      } finally {
                        setAuthBusy(false);
                      }
                    }}
                    sx={{
                      fontWeight: 900,
                      textTransform: "none",
                      color: "color-mix(in srgb, var(--text-invert) 78%, transparent)",
                      justifyContent: "flex-start",
                      px: 0,
                      mb: 0.5,
                    }}
                  >
                    Resend code
                  </Button>
                </>
              ) : (
                <>
                  <TextField
                    fullWidth
                    label="Email"
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    autoComplete="email"
                    size="small"
                    className={styles.authInput}
                    sx={{ mb: 1.5 }}
                    InputLabelProps={{ style: { color: "color-mix(in srgb, var(--text-invert) 72%, transparent)" } }}
                  />

                  {authMode === "forgot" ? null : authMode === "reset" ? (
                    <>
                      <TextField
                        fullWidth
                        label="Reset code"
                        value={authCode}
                        onChange={(e) => setAuthCode(e.target.value)}
                        autoComplete="one-time-code"
                        size="small"
                        className={styles.authInput}
                        sx={{ mb: 1.25 }}
                        InputLabelProps={{ style: { color: "color-mix(in srgb, var(--text-invert) 72%, transparent)" } }}
                      />
                      <TextField
                        fullWidth
                        label="New password"
                        type={authShowPassword ? "text" : "password"}
                        value={authPassword}
                        onChange={(e) => setAuthPassword(e.target.value)}
                        autoComplete="new-password"
                        size="small"
                        className={styles.authInput}
                        sx={{ mb: 1.0 }}
                        InputLabelProps={{ style: { color: "color-mix(in srgb, var(--text-invert) 72%, transparent)" } }}
                        InputProps={{
                          endAdornment: (
                            <InputAdornment position="end">
                              <IconButton
                                aria-label={authShowPassword ? "Hide password" : "Show password"}
                                onClick={() => setAuthShowPassword((v) => !v)}
                                edge="end"
                                size="small"
                                sx={{ color: "color-mix(in srgb, var(--text-invert) 70%, transparent)" }}
                              >
                                {authShowPassword ? <VisibilityOffRoundedIcon fontSize="small" /> : <VisibilityRoundedIcon fontSize="small" />}
                              </IconButton>
                            </InputAdornment>
                          ),
                        }}
                      />
                      <TextField
                        fullWidth
                        label="Confirm new password"
                        type={authShowPassword ? "text" : "password"}
                        value={authPassword2}
                        onChange={(e) => setAuthPassword2(e.target.value)}
                        autoComplete="new-password"
                        size="small"
                        className={styles.authInput}
                        sx={{ mb: 0.5 }}
                        InputLabelProps={{ style: { color: "color-mix(in srgb, var(--text-invert) 72%, transparent)" } }}
                        InputProps={{
                          endAdornment: (
                            <InputAdornment position="end">
                              <IconButton
                                aria-label={authShowPassword ? "Hide password" : "Show password"}
                                onClick={() => setAuthShowPassword((v) => !v)}
                                edge="end"
                                size="small"
                                sx={{ color: "color-mix(in srgb, var(--text-invert) 70%, transparent)" }}
                              >
                                {authShowPassword ? <VisibilityOffRoundedIcon fontSize="small" /> : <VisibilityRoundedIcon fontSize="small" />}
                              </IconButton>
                            </InputAdornment>
                          ),
                        }}
                      />
                    </>
                  ) : (
                    <>
                      <TextField
                        fullWidth
                        label="Password"
                        type={authShowPassword ? "text" : "password"}
                        value={authPassword}
                        onChange={(e) => setAuthPassword(e.target.value)}
                        autoComplete={authMode === "login" ? "current-password" : "new-password"}
                        size="small"
                        className={styles.authInput}
                        sx={{ mb: 0.5 }}
                        InputLabelProps={{ style: { color: "color-mix(in srgb, var(--text-invert) 72%, transparent)" } }}
                        InputProps={{
                          endAdornment: (
                            <InputAdornment position="end">
                              <IconButton
                                aria-label={authShowPassword ? "Hide password" : "Show password"}
                                onClick={() => setAuthShowPassword((v) => !v)}
                                edge="end"
                                size="small"
                                sx={{ color: "color-mix(in srgb, var(--text-invert) 70%, transparent)" }}
                              >
                                {authShowPassword ? <VisibilityOffRoundedIcon fontSize="small" /> : <VisibilityRoundedIcon fontSize="small" />}
                              </IconButton>
                            </InputAdornment>
                          ),
                        }}
                      />

                      {authMode === "login" ? (
                        <Button
                          variant="text"
                          disabled={authBusy}
                          onClick={() => {
                            if (authBusy) return;
                            setAuthMode("forgot");
                            setAuthError("");
                            setAuthInfo("");
                            setAuthCode("");
                            setAuthPassword("");
                            setAuthPassword2("");
                          }}
                          sx={{
                            fontWeight: 900,
                            textTransform: "none",
                            color: "color-mix(in srgb, var(--text-invert) 78%, transparent)",
                            justifyContent: "flex-start",
                            px: 0,
                            mb: 0.5,
                          }}
                        >
                          Forgot password?
                        </Button>
                      ) : null}
                    </>
                  )}
                </>
              )}

              {authInfo ? (
                <div className={styles.authHint} style={{ marginTop: 10 }}>
                  {authInfo}
                </div>
              ) : null}
              {authError ? <div className={styles.authError}>{authError}</div> : null}

              <div className={styles.authActions}>
                <Button
                  variant="text"
                  onClick={() => setAuthOpen(false)}
                  disabled={authBusy}
                  sx={{ fontWeight: 900, color: "color-mix(in srgb, var(--text-invert) 78%, transparent)", textTransform: "none" }}
                >
                  Cancel
                </Button>
                <Button
                  variant="contained"
                  disabled={authBusy}
                  onClick={async () => {
                    if (authBusy) return;
                    setAuthBusy(true);
                    setAuthError("");
                    setAuthInfo("");
                    try {
                      if (authMode === "login") {
                        await auth.login(authEmail, authPassword);
                        setAuthOpen(false);
                        setAuthPassword("");
                        setAuthPassword2("");
                        setAuthCode("");
                      } else if (authMode === "signup") {
                        const out = await auth.signup(authEmail, authPassword);
                        if (out.next === "confirm") {
                          setAuthMode("confirm");
                          setAuthError("");
                        } else {
                          await auth.login(authEmail, authPassword);
                          setAuthOpen(false);
                          setAuthPassword("");
                          setAuthPassword2("");
                          setAuthCode("");
                        }
                      } else if (authMode === "confirm") {
                        await auth.confirm(authEmail, authCode);
                        if (String(authPassword || "").trim()) {
                          await auth.login(authEmail, authPassword);
                          setAuthOpen(false);
                          setAuthPassword("");
                          setAuthPassword2("");
                          setAuthCode("");
                          setAuthMode("login");
                        } else {
                          setAuthMode("login");
                          setAuthInfo("Email confirmed. Please log in.");
                          setAuthCode("");
                        }
                      } else if (authMode === "forgot") {
                        await auth.forgotPassword(authEmail);
                        setAuthMode("reset");
                        setAuthCode("");
                        setAuthPassword("");
                        setAuthPassword2("");
                        setAuthInfo("Reset code sent. Check your email.");
                      } else {
                        if (authPassword !== authPassword2) throw new Error("Passwords do not match");
                        await auth.resetPassword(authEmail, authCode, authPassword);
                        setAuthInfo("Password updated. You can now log in.");
                        setAuthMode("login");
                        setAuthCode("");
                        setAuthPassword("");
                        setAuthPassword2("");
                      }
                    } catch (e: any) {
                      setAuthError(String(e?.message || "Login failed"));
                    } finally {
                      setAuthBusy(false);
                    }
                  }}
                  sx={{
                    fontWeight: 900,
                    textTransform: "none",
                    borderRadius: 999,
                    px: 2.5,
                    backgroundColor: 'var(--accent-500)',
                    color: 'var(--accent-contrast)',
                    '&:hover': { backgroundColor: 'color-mix(in srgb, var(--accent-500) 85%, black 15%)' }
                  }}
                >
                    {authMode === "login"
                      ? "Login"
                      : authMode === "signup"
                        ? "Create account"
                        : authMode === "confirm"
                          ? "Confirm and Login"
                          : authMode === "forgot"
                            ? "Send reset code"
                            : "Reset password"}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {error && (
        <div style={{ color: "#fff", padding: "6px 12px", fontSize: 12 }}>{error}</div>
      )}
    </header>
  );
}
