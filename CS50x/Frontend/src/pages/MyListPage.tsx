import { useMemo, useState, useEffect } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";

import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import { useAuth } from "../auth/AuthContext";
import { useFavorites } from "../favorites/FavoritesContext";
import { getPlotByImdbId } from "../utils/localPlots";

import FavoriteRoundedIcon from "@mui/icons-material/FavoriteRounded";
import FavoriteBorderRoundedIcon from "@mui/icons-material/FavoriteBorderRounded";

import styles from "../styles/MovieCards.module.css";
import sectionStyles from "../styles/SectionHeader.module.css";

let media1000ImdbByTmdbIdPromise: Promise<Map<number, string>> | null = null;
async function loadMedia1000ImdbByTmdbId(): Promise<Map<number, string>> {
  if (media1000ImdbByTmdbIdPromise) return media1000ImdbByTmdbIdPromise;
  media1000ImdbByTmdbIdPromise = (async () => {
    try {
      const resp = await fetch("/media_1000.json", { cache: "no-cache" });
      if (!resp.ok) return new Map();
      const data = await resp.json().catch(() => ({}));
      const raw = data?.byTmdbId && typeof data.byTmdbId === "object" ? data.byTmdbId : {};
      const map = new Map<number, string>();
      for (const [k, v] of Object.entries(raw)) {
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

export default function MyListPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { favorites, isFavorite, toggleFavorite } = useFavorites();

  const [query, setQuery] = useState("");

  const pageBg = "var(--brand-900)";
  const muted = "var(--surface-muted)";

  const [plotByTmdbId, setPlotByTmdbId] = useState<Map<number, string>>(() => new Map());

  // Populate local plots for favorites (non-blocking)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!favorites || !favorites.length) return;
        const tmdbToImdb = await loadMedia1000ImdbByTmdbId();
        const ids = favorites.map((f) => f.tmdbId).filter((id) => Number.isFinite(id) && id > 0);
        if (!ids.length) return;
        const fetched = await Promise.all(
          ids.map(async (id) => {
            const imdbId = tmdbToImdb.get(id) || "";
            if (!/^tt\d+$/i.test(String(imdbId))) return { id, overview: "" };
            const overview = String((await getPlotByImdbId(imdbId)) || "").trim();
            return { id, overview };
          })
        );
        if (cancelled) return;
        setPlotByTmdbId((prev) => {
          const next = new Map(prev);
          fetched.forEach((r) => {
            if (r && Number.isFinite(r.id) && String(r.overview || "").trim()) next.set(r.id, r.overview);
          });
          return next;
        });
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [favorites]);

  const title = useMemo(() => {
    const name = String(user?.email || "").split("@")[0];
    if (!user) return "My List";
    return name ? `${name}'s List` : "My List";
  }, [user]);

  return (
    <>
      <Navbar
        query={query}
        setQuery={setQuery}
        onRecommend={(nextResults, usedQuery) => {
          const q = String(usedQuery || query || "").trim();
          navigate(`/search?q=${encodeURIComponent(q)}`, {
            state: { results: nextResults, q },
          });
        }}
      />

      <div style={{ backgroundColor: pageBg, minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        <div style={{ flex: 1 }}>
          <Container style={{ paddingTop: 36, paddingBottom: 72 }}>
            <div className={sectionStyles.sectionHeader}>
              <div className={sectionStyles.sectionTitle}>{title}</div>
              <div className={sectionStyles.sectionSub}>
                Saved favourite movies
                {user ? ` · ${favorites.length} saved` : ""}
              </div>
            </div>

            {!user ? (
              <div style={{ color: muted, lineHeight: 1.7, marginTop: 18 }}>
                Please{" "}
                <Link to="/" style={{ textDecoration: "underline", color: "var(--accent-500)" }}>
                  log in
                </Link>{" "}
                to use My List.
              </div>
            ) : favorites.length === 0 ? (
              <div style={{ color: muted, lineHeight: 1.7, marginTop: 18 }}>
                No favorites yet. Go back to{" "}
                <Link to="/" style={{ textDecoration: "underline", color: "var(--accent-500)" }}>
                  Home
                </Link>{" "}
                and tap the heart to save movies.
              </div>
            ) : (
              <div className={styles.movieGrid} style={{ marginTop: 18 }}>
                {favorites.map((m) => {
                  const year = String(m.year || "").trim();
                  const posterUrl = String(m.posterUrl || "").trim();

                  const fav = isFavorite(m.tmdbId);

                  // sessionStorage cached details (if available)
                  const DETAILS_CACHE_PREFIX = "popcorn.tmdb.details:";
                  const detailsCacheKey = (id: number) => `${DETAILS_CACHE_PREFIX}${id}`;
                  let _voteFallback: number | undefined = undefined;
                  let _overviewFallback: string | undefined = undefined;
                  try {
                    const raw = sessionStorage.getItem(detailsCacheKey(m.tmdbId));
                    if (raw) {
                      const parsed = JSON.parse(raw);
                      if (parsed && typeof parsed.vote_average === 'number' && Number.isFinite(parsed.vote_average)) {
                        _voteFallback = parsed.vote_average;
                      }
                      if (parsed && typeof parsed.overview === 'string' && String(parsed.overview).trim()) {
                        _overviewFallback = String(parsed.overview).trim();
                      }
                    }
                  } catch {
                    /* ignore */
                  }

                  const rating = typeof _voteFallback === "number" && Number.isFinite(_voteFallback) ? _voteFallback.toFixed(1) : "—";
                  const overviewText = _overviewFallback || plotByTmdbId.get(m.tmdbId) || "";

                  return (
                    <div
                      key={String(m.tmdbId)}
                      className={styles.movieCard}
                      style={{ cursor: "pointer" }}
                      onClick={() => navigate(`/movie/${m.tmdbId}`)}
                      title={m.title}
                    >
                      <button
                        type="button"
                        className={`${styles.favBtn}${fav ? ` ${styles.favBtnActive}` : ""}`}
                        aria-label={fav ? "Remove from My List" : "Add to My List"}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFavorite({
                            tmdbId: m.tmdbId,
                            title: m.title,
                            year,
                            posterUrl,
                          });
                        }}
                      >
                        {fav ? <FavoriteRoundedIcon /> : <FavoriteBorderRoundedIcon />}
                      </button>

                      <div className={styles.poster} style={{ background: "var(--surface-muted)" }}>
                        <div className={styles.posterPlaceholder}>
                          <span className={styles.posterPlaceholderTitle}>{m.title || "No poster"}</span>
                        </div>
                        {posterUrl ? (
                          <img
                            src={posterUrl}
                            alt={m.title}
                            style={{ width: "100%", height: "100%", objectFit: "cover", position: "relative", zIndex: 1, display: "block" }}
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                            }}
                          />
                        ) : null}
                      </div>
                      <div className={styles.meta}>
                        <div className={styles.title} style={{ color: "var(--text-invert)" }}>
                          {m.title}
                          {year ? ` (${year})` : ""}
                        </div>
                        <div className={styles.rating} style={{ color: "var(--text-invert)" }}>
                          <div className={styles.ratingNum}>{rating}</div>
                          <div className={styles.ratingStar}>★</div>
                        </div>
                        <div className={styles.submeta}>
                          {year ? <span className={styles.metaPart}>{year}</span> : null}
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
          </Container>
        </div>

        <Footer />
      </div>
    </>
  );
}

function Container({ children, style = {} }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        width: "100%",
        maxWidth: 1520,
        margin: "0 auto",
        padding: "0 32px",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
