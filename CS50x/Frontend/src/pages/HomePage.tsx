// note: src/pages/HomePage.tsx
import { memo, useEffect, useMemo, useState } from "react";
import styles from "../styles/MovieCards.module.css";
import sectionStyles from "../styles/SectionHeader.module.css";
import homeStyles from "./HomePage.module.css";
import { useNavigate } from "react-router-dom";

import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import { useAuth } from "../auth/AuthContext";
import { useFavorites } from "../favorites/FavoritesContext";
import { tmdbGetMovieDetails } from "../utils/tmdb";
import { getPlotByImdbId } from "../utils/localPlots";
import { getRatingByImdbId } from "../utils/localRatings";

import FavoriteRoundedIcon from "@mui/icons-material/FavoriteRounded";
import FavoriteBorderRoundedIcon from "@mui/icons-material/FavoriteBorderRounded";

type LocalTop10Item = {
  imdbId: string;
  title?: string;
  posterUrl?: string | null;
  backdropUrls?: string[];
  trailers?: Array<{ url?: string; name?: string; site?: string; type?: string; key?: string }>;
};

async function loadLocalTop10(): Promise<LocalTop10Item[]> {
  try {
    const resp = await fetch("/media_top10.json", { cache: "force-cache" });
    if (!resp.ok) return [];
    const data = await resp.json().catch(() => ({}));
    const items: LocalTop10Item[] = Array.isArray(data?.items) ? data.items : [];
    return items.filter((x) => x && String(x.imdbId || "").trim()).slice(0, 10);
  } catch {
    return [];
  }
}

type Media1000Item = {
  tmdbId: number;
  imdbId?: string | null;
};

let imdbToTmdbIdPromise: Promise<Map<string, number>> | null = null;
async function loadImdbToTmdbId(): Promise<Map<string, number>> {
  if (imdbToTmdbIdPromise) return imdbToTmdbIdPromise;

  imdbToTmdbIdPromise = (async () => {
    try {
      const resp = await fetch("/media_1000.json", { cache: "force-cache" });
      if (!resp.ok) return new Map();

      const data = await resp.json().catch(() => ({}));
      const byTmdbId: Record<string, Media1000Item> =
        data && typeof data === "object" && data.byTmdbId && typeof data.byTmdbId === "object" ? data.byTmdbId : {};

      const out = new Map<string, number>();
      Object.values(byTmdbId).forEach((v) => {
        const imdb = String(v?.imdbId || "").trim();
        const tmdbId = typeof v?.tmdbId === "number" ? v.tmdbId : Number((v as any)?.tmdbId);
        if (!imdb) return;
        if (!Number.isFinite(tmdbId) || tmdbId <= 0) return;
        out.set(imdb, tmdbId);
      });
      return out;
    } catch {
      return new Map();
    }
  })();

  return imdbToTmdbIdPromise;
}

function pickRandom<T>(arr: T[]): T | undefined {
  if (!arr.length) return undefined;
  return arr[Math.floor(Math.random() * arr.length)];
}

function youtubeEmbedFromTrailer(t?: { site?: string; key?: string; url?: string }): string {
  const site = String(t?.site || "").toLowerCase();
  const key = String(t?.key || "").trim();
  if (site === "youtube" && key) return `https://www.youtube.com/embed/${encodeURIComponent(key)}`;

  const raw = String(t?.url || "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    if (u.hostname.includes("youtu.be")) {
      const id = u.pathname.replace("/", "").trim();
      if (id) return `https://www.youtube.com/embed/${encodeURIComponent(id)}`;
    }
    if (u.hostname.includes("youtube.com")) {
      const id = u.searchParams.get("v");
      if (id) return `https://www.youtube.com/embed/${encodeURIComponent(id)}`;
    }
  } catch {
    // ignore
  }
  return "";
}

export default function HomePage() {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();

  const { user } = useAuth();
  const { isFavorite, toggleFavorite } = useFavorites();

  const [top10, setTop10] = useState<LocalTop10Item[]>([]);
  const [imdbToTmdbId, setImdbToTmdbId] = useState<Map<string, number>>(() => new Map());
  const [plotByImdbId, setPlotByImdbId] = useState<Map<string, string>>(() => new Map());
  const [ratingByImdbId, setRatingByImdbId] = useState<Map<string, number>>(() => new Map());
  const [heroPlaying, setHeroPlaying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [list, map] = await Promise.all([loadLocalTop10(), loadImdbToTmdbId()]);
      if (!cancelled) {
        setTop10(list);
        setImdbToTmdbId(map);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!top10.length) return;

      // 1) Fast path: fill plots from local cache by imdbId (no TMDb required).
      const imdbIds = top10
        .map((m) => String(m?.imdbId || "").trim())
        .filter((x) => x);

      if (imdbIds.length) {
        const plots = await Promise.all(
          imdbIds.map(async (imdbId) => ({ imdbId, overview: String(await getPlotByImdbId(imdbId)).trim() }))
        ).catch(() => [] as Array<{ imdbId: string; overview: string }>);

        if (cancelled) return;
        setPlotByImdbId((prev) => {
          const next = new Map(prev);
          plots.forEach((p) => {
            if (!p.imdbId || !p.overview) return;
            if (!String(next.get(p.imdbId) || "").trim()) next.set(p.imdbId, p.overview);
          });
          return next;
        });
      }

      // 1.5) Fast path: fill ratings from local cache by imdbId (no TMDb required).
      if (imdbIds.length) {
        const votes = await Promise.all(
          imdbIds.map(async (imdbId) => ({ imdbId, vote: await getRatingByImdbId(imdbId) }))
        ).catch(() => [] as Array<{ imdbId: string; vote?: number }>);

        if (cancelled) return;
        setRatingByImdbId((prev) => {
          const next = new Map(prev);
          votes.forEach((v) => {
            const imdbId = String(v.imdbId || "").trim();
            if (!imdbId) return;
            const n = typeof v.vote === "number" ? v.vote : undefined;
            if (typeof n !== "number" || !Number.isFinite(n)) return;
            if (!(typeof next.get(imdbId) === "number" && Number.isFinite(next.get(imdbId) as number))) {
              next.set(imdbId, n);
            }
          });
          return next;
        });
      }

      // 2) Background enrichment: if we have TMDb ids, prefer TMDb overview.
      if (!imdbToTmdbId.size) return;

      const candidates = top10
        .map((m) => {
          const imdbId = String(m?.imdbId || "").trim();
          const tmdbId = imdbId ? imdbToTmdbId.get(imdbId) : undefined;
          return {
            imdbId,
            tmdbId: typeof tmdbId === "number" && Number.isFinite(tmdbId) && tmdbId > 0 ? tmdbId : undefined,
          };
        })
        .filter((x) => x.imdbId && typeof x.tmdbId === "number") as Array<{ imdbId: string; tmdbId: number }>;

      if (!candidates.length) return;

      const results = await Promise.allSettled(
        candidates.map(async ({ imdbId, tmdbId }) => {
          const details = await tmdbGetMovieDetails(tmdbId);
          const overview = String(details?.overview || "").trim();
          const vote = typeof details?.vote_average === "number" && Number.isFinite(details.vote_average) ? details.vote_average : undefined;
          return { imdbId, overview, vote } as any;
        })
      );

      if (cancelled) return;
      setPlotByImdbId((prev) => {
        const next = new Map(prev);
        results.forEach((r) => {
          if (r.status !== "fulfilled") return;
          const imdbId = String(r.value.imdbId || "").trim();
          const overview = String(r.value.overview || "").trim();
          if (!imdbId || !overview) return;
          next.set(imdbId, overview);
        });
        return next;
      });

      // store vote_average for top10 display
      setRatingByImdbId((prev) => {
        const next = new Map(prev);
        results.forEach((r) => {
          if (r.status !== "fulfilled") return;
          const imdbId = String(r.value.imdbId || "").trim();
          const vote = typeof r.value.vote === "number" ? r.value.vote : undefined;
          if (!imdbId || typeof vote !== "number") return;
          next.set(imdbId, vote);
        });
        return next;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [top10, imdbToTmdbId]);

  const featured = useMemo(() => {
    if (!top10.length) return undefined;
    const withTrailers = top10.filter((x) => Array.isArray(x.trailers) && x.trailers!.length > 0);
    return pickRandom(withTrailers.length ? withTrailers : top10);
  }, [top10]);

  const featuredBackdrop = useMemo(() => {
    const urls = featured?.backdropUrls;
    if (!Array.isArray(urls) || !urls.length) return "";
    return String(pickRandom(urls) || "");
  }, [featured]);

  const featuredTrailer = useMemo(() => {
    const item = featured;
    const trailers = (item?.trailers || []).filter((t) => t && (t.key || t.url));
    const preferred = trailers.find((t) => String(t.type || "").toLowerCase() === "trailer") || trailers[0];
    return preferred;
  }, [featured]);

  const featuredTrailerEmbed = useMemo(() => youtubeEmbedFromTrailer(featuredTrailer), [featuredTrailer]);

  const eligibleForRoulette = useMemo(() => {
    return top10
      .map((m) => {
        const imdbId = String(m?.imdbId || "").trim();
        const title = String(m?.title || "").trim();
        const posterUrl = String(m?.posterUrl || "").trim();
        const hasTrailer = Boolean((m as any).trailerUrl || ((m as any).trailers && (m as any).trailers.length));
        const plot = imdbId ? String(plotByImdbId.get(imdbId) || "").trim() : "";
        if (!imdbId || !title || !hasTrailer || !plot) return null;
        const tmdbId = imdbToTmdbId.get(imdbId);
        const rating = typeof ratingByImdbId.get(imdbId) === "number" ? (ratingByImdbId.get(imdbId) as number) : undefined;
        return { ...m, imdbId, title, posterUrl, tmdbId, plot, rating } as any;
      })
      .filter(Boolean) as Array<LocalTop10Item & { tmdbId?: number; plot: string; rating?: number }>;
  }, [top10, imdbToTmdbId, plotByImdbId, ratingByImdbId]);

  useEffect(() => {
    // If featured changes, reset playback state
    setHeroPlaying(false);
  }, [featuredTrailerEmbed, featured?.imdbId]);

  const heroTrailerSrc = useMemo(() => {
    if (!featuredTrailerEmbed) return "";

    const params = new URLSearchParams();
    params.set("autoplay", heroPlaying ? "1" : "0");
    params.set("mute", "1");
    params.set("controls", heroPlaying ? "1" : "0");
    params.set("rel", "0");
    params.set("modestbranding", "1");
    params.set("playsinline", "1");

    return `${featuredTrailerEmbed}?${params.toString()}`;
  }, [featuredTrailerEmbed, heroPlaying]);

  const pageBg = "var(--brand-900)";
  const surfaceMuted = "rgba(255,255,255,0.72)";

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

      <div style={{ backgroundColor: pageBg }}>
        {/* Netflix-like hero */}
        <div
          style={{
            width: "100%",
            minHeight: 640,
            backgroundColor: "var(--brand-900)",
            backgroundImage: !heroTrailerSrc && featuredBackdrop ? `url(${featuredBackdrop})` : undefined,
            backgroundSize: "cover",
            backgroundPosition: "center",
            position: "relative",
            borderBottom: "1px solid var(--border-1)",
          }}
        >
          {/* trailer as background */}
          {heroTrailerSrc ? (
            <iframe
              title={String(featured?.title || "Trailer")}
              src={heroTrailerSrc}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                border: 0,
                pointerEvents: heroPlaying ? "auto" : "none",
              }}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          ) : null}
          {/* Click-to-pause overlay: when trailer is playing, capture clicks to stop playback */}
          {heroPlaying ? (
            <div
              onClick={() => setHeroPlaying(false)}
              title="Click to pause"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                // Leave the bottom area free so the YouTube controls/timeline remain draggable.
                bottom: 110,
                cursor: "pointer",
                background: "transparent",
                zIndex: 5,
              }}
            />
          ) : null}
          {/* Vignette: darken corners and focus center; non-interfering */}
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              background: "radial-gradient(ellipse at center, rgba(0,0,0,0) 20%, rgba(0,0,0,0.35) 50%, rgba(0,0,0,0.7) 100%)",
              opacity: heroPlaying ? 0 : 1,
              transition: "opacity 220ms ease",
            }}
          />
          

          {/* overlay gradient */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "linear-gradient(90deg, rgba(0,0,0,0.86) 0%, rgba(0,0,0,0.30) 60%, rgba(0,0,0,0.12) 100%)",
              pointerEvents: "none",
              opacity: heroPlaying ? 0.25 : 1,
            }}
          />
          <Container style={{ paddingTop: 180, paddingBottom: 56, position: "relative" }}>
            <div style={{ maxWidth: 760, opacity: heroPlaying ? 0 : 1, pointerEvents: heroPlaying ? "none" : "auto" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 900,
                    letterSpacing: "0.22em",
                    color: surfaceMuted,
                  }}
                >
                  MOVIE
                </div>
              </div>

              <div
                style={{
                  fontSize: 64,
                  fontWeight: 900,
                  color: "var(--text-invert)",
                  letterSpacing: "-0.03em",
                  lineHeight: 0.98,
                  textTransform: "uppercase",
                }}
              >
                {String(featured?.title || "Popular Picks")}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
                <div
                    style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    height: 18,
                    padding: "0 6px",
                    borderRadius: 4,
                    background: "var(--brand-900)",
                    color: "var(--text-invert)",
                    fontWeight: 900,
                    fontSize: 11,
                    letterSpacing: "0.06em",
                  }}
                >
                  TOP 10
                </div>
                <div style={{ color: "var(--text-invert)", fontWeight: 800, fontSize: 18 }}>
                  #1 in Movies Today
                </div>
              </div>

              <div
                style={{
                  marginTop: 18,
                  color: "var(--text-invert)",
                  opacity: 0.94,
                  fontSize: 18,
                  lineHeight: 1.6,
                }}
              >
                {featured
                  ? "When you don’t know what to watch next, start here - a curated pick from today’s popular list."
                  : "Loading popular picks…"}
              </div>

              <div style={{ display: "flex", gap: 18, marginTop: 22, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => {
                    if (!featuredTrailerEmbed) return;
                    setHeroPlaying(true);
                  }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 12,
                    height: 50,
                    padding: "0 20px",
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.12)",
                    background: "var(--text-invert)",
                    color: "var(--brand-900)",
                    fontWeight: 900,
                    cursor: featuredTrailerEmbed ? "pointer" : "default",
                    opacity: featuredTrailerEmbed ? 1 : 0.75,
                  }}
                >
                  Play
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const t = String(featured?.title || "").trim();
                    const q = t || query;
                    if (!q) return;
                    navigate(`/search?q=${encodeURIComponent(q)}`);
                  }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 12,
                    height: 50,
                    padding: "0 20px",
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.18)",
                    background: "rgba(255,255,255,0.12)",
                    color: "var(--text-invert)",
                    fontWeight: 900,
                    cursor: "pointer",
                  }}
                >
                  More info
                </button>
              </div>
            </div>
          </Container>

          {/* maturity badge (visual only) */}
          <div
            style={{
              position: "absolute",
              right: 0,
              bottom: 92,
              padding: "12px 14px",
              borderLeft: "3px solid rgba(255,255,255,0.55)",
              background: "rgba(0,0,0,0.30)",
              color: "var(--text-invert)",
              fontWeight: 900,
              letterSpacing: "0.06em",
              minWidth: 78,
              textAlign: "center",
            }}
          >
            TV-14
          </div>
        </div>

        {/* Random movie roulette (below trailer / above Popular movies) */}
        <div className={homeStyles.rouletteSection}>
          <Container style={{ paddingTop: 34, paddingBottom: 10, maxWidth: 1680 }}>
            <RouletteSection
              eligible={eligibleForRoulette}
              user={user}
              isFavorite={isFavorite}
              toggleFavorite={toggleFavorite}
              navigate={navigate}
            />
          </Container>
        </div>

        {/* Popular movies grid */}
        <div className={homeStyles.homePopular}>
          <Container style={{ paddingTop: 56, paddingBottom: 120, maxWidth: 1680 }}>
            <div className={sectionStyles.sectionHeader}>
              <div className={sectionStyles.sectionTitle}>Popular movies</div>
              <div className={sectionStyles.sectionSub}>Top 10 picks</div>
            </div>

            <div className={`${styles.movieGrid} ${styles.homeMovieGrid}`} style={{ marginTop: 18, marginBottom: 0 }}>
              {top10.map((m) => {
                const title = String(m?.title || "").trim();
                const posterUrl = String(m?.posterUrl || "").trim();
                const imdbId = String(m?.imdbId || "").trim();
                const hasTrailer = Boolean((m as any).trailerUrl || ((m as any).trailers && (m as any).trailers.length));
                const plot = imdbId ? String(plotByImdbId.get(imdbId) || "").trim() : "";
                // Hide any movie missing a trailer OR a plot
                if (!hasTrailer || !plot) return null;
                const tmdbId = imdbId ? imdbToTmdbId.get(imdbId) : undefined;
                const hasFavId = typeof tmdbId === "number" && Number.isFinite(tmdbId) && tmdbId > 0;
                const fav = hasFavId ? isFavorite(tmdbId) : false;

                return (
                  <div
                    key={String(m.imdbId)}
                    className={styles.movieCard}
                    style={{ cursor: title ? "pointer" : "default" }}
                    onClick={() => {
                      if (typeof tmdbId === "number" && Number.isFinite(tmdbId) && tmdbId > 0) {
                        navigate(`/movie/${tmdbId}`);
                        return;
                      }

                      // Fallback: still let users move forward
                      const q = title;
                      if (!q) return;
                      navigate(`/search?q=${encodeURIComponent(q)}`);
                    }}
                    title={title}
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
                            tmdbId: tmdbId as number,
                            title: title || `Movie ${tmdbId}`,
                            year: "",
                            posterUrl,
                          });
                        }}
                      >
                        {fav ? <FavoriteRoundedIcon /> : <FavoriteBorderRoundedIcon />}
                      </button>
                    ) : null}

                    <div className={styles.poster} style={{ background: "var(--surface-muted)" }}>
                      <div className={styles.posterPlaceholder}>
                        <span className={styles.posterPlaceholderTitle}>{title || "No poster"}</span>
                      </div>
                      {posterUrl ? (
                        <img
                          src={posterUrl}
                          alt={title}
                          style={{ width: "100%", height: "100%", objectFit: "cover", position: "relative", zIndex: 1, display: "block" }}
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                          }}
                        />
                      ) : null}
                    </div>
                    <div className={styles.meta}>
                      <div className={`${styles.title} ${styles.homeTitle}`} style={{ color: "var(--text-invert)" }}>
                        {title || "Untitled"}
                      </div>
                      {/* rating placed under title to match search results */}
                      <div style={{ marginTop: 8 }}>
                        <div className={styles.rating} style={{ color: "var(--text-invert)" }}>
                          <div className={styles.ratingNum}>
                            {(() => {
                              const v = typeof imdbId === "string" ? ratingByImdbId.get(imdbId) : undefined;
                              return typeof v === "number" && Number.isFinite(v) ? v.toFixed(1) : "—";
                            })()}
                          </div>
                          <div className={styles.ratingStar}>★</div>
                        </div>
                      </div>
                      {plot ? (
                        <>
                          <div className={styles.divider} />
                          <div className={styles.homeMetaRow} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div className={`${styles.overview} ${styles.homeOverview}`} style={{ color: "var(--text-invert)", flex: 1 }}>
                              {plot}
                            </div>
                          </div>
                        </>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </Container>
        </div>

        <Footer />
      </div>
    </>
  );
}

const RouletteSection = memo(function RouletteSection({
  eligible,
  user,
  isFavorite,
  toggleFavorite,
  navigate,
}: {
  eligible: Array<LocalTop10Item & { tmdbId?: number; plot: string; rating?: number }>;
  user: any;
  isFavorite: (tmdbId: number) => boolean;
  toggleFavorite: (m: { tmdbId: number; title: string; year: string; posterUrl: string }) => void;
  navigate: (to: string, opts?: any) => void;
}) {
  const [rouletteAngle, setRouletteAngle] = useState(0);
  const [rouletteSpinning, setRouletteSpinning] = useState(false);
  const [roulettePick, setRoulettePick] = useState<(LocalTop10Item & { tmdbId?: number; plot: string; rating?: number }) | null>(null);
  const [roulettePickNonce, setRoulettePickNonce] = useState(0);

  const picked = Boolean(roulettePick);

  return (
    <div className={homeStyles.rouletteGrid} data-picked={picked ? "1" : "0"}>
      <div className={homeStyles.rouletteLeft}>
        <div className={homeStyles.rouletteTitleRow}>
          <div className={homeStyles.rouletteTitle}>Random movie roulette</div>
          <div className={homeStyles.rouletteSub}>Click the wheel and get a pick</div>
        </div>

        <button
          type="button"
          className={homeStyles.rouletteButton}
          onClick={() => {
            if (!eligible.length) return;
            const next = (pickRandom(eligible) || eligible[0]) as any;
            setRoulettePick(next);
            setRoulettePickNonce((n) => n + 1);
            setRouletteSpinning(true);
            setRouletteAngle((prev) => {
              const extraTurns = 4 * 360;
              const jitter = Math.floor(Math.random() * 360);
              return prev + extraTurns + jitter;
            });
          }}
          disabled={!eligible.length}
          title={eligible.length ? "Spin" : "Loading…"}
        >
          <span
            className={homeStyles.rouletteWheel}
            style={{ transform: `rotate(${rouletteAngle}deg)` }}
            onTransitionEnd={() => setRouletteSpinning(false)}
            data-spinning={rouletteSpinning ? "1" : "0"}
          />
          <span className={homeStyles.roulettePointer} aria-hidden />
          <span className={homeStyles.rouletteCta}>{eligible.length ? "SPIN" : "LOADING"}</span>
        </button>

        <div className={homeStyles.rouletteHint}>
          {roulettePick ? (
            <>
              Selected: <span style={{ fontWeight: 900 }}>{String(roulettePick.title || "")}</span>
            </>
          ) : eligible.length ? (
            "Spin to pick a movie"
          ) : (
            "Loading movies…"
          )}
        </div>
      </div>

      <div className={homeStyles.rouletteRight}>
        {roulettePick ? (
          (() => {
            const imdbId = String(roulettePick.imdbId || "").trim();
            const title = String(roulettePick.title || "").trim();
            const posterUrl = String(roulettePick.posterUrl || "").trim();
            const plot = String((roulettePick as any).plot || "").trim();
            const tmdbId = (roulettePick as any).tmdbId as number | undefined;
            const hasFavId = typeof tmdbId === "number" && Number.isFinite(tmdbId) && tmdbId > 0;
            const fav = hasFavId ? isFavorite(tmdbId) : false;

            return (
              <div
                key={`${imdbId}-${roulettePickNonce}`}
                className={homeStyles.rouletteCardWrap}
                onClick={() => {
                  if (typeof tmdbId === "number" && Number.isFinite(tmdbId) && tmdbId > 0) {
                    navigate(`/movie/${tmdbId}`);
                    return;
                  }
                  if (title) navigate(`/search?q=${encodeURIComponent(title)}`);
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" && e.key !== " ") return;
                  e.preventDefault();
                  if (typeof tmdbId === "number" && Number.isFinite(tmdbId) && tmdbId > 0) {
                    navigate(`/movie/${tmdbId}`);
                    return;
                  }
                  if (title) navigate(`/search?q=${encodeURIComponent(title)}`);
                }}
                title={title}
              >
                <div className={styles.movieCard} style={{ width: "100%", maxWidth: 340 }}>
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
                          tmdbId: tmdbId as number,
                          title: title || `Movie ${tmdbId}`,
                          year: "",
                          posterUrl,
                        });
                      }}
                    >
                      {fav ? <FavoriteRoundedIcon /> : <FavoriteBorderRoundedIcon />}
                    </button>
                  ) : null}

                  <div className={`${styles.poster} ${homeStyles.roulettePoster}`} style={{ background: "var(--surface-muted)" }}>
                    <div className={styles.posterPlaceholder}>
                      <span className={styles.posterPlaceholderTitle}>{title || "No poster"}</span>
                    </div>
                    {posterUrl ? (
                      <img
                        src={posterUrl}
                        alt={title}
                        style={{
                          maxWidth: "100%",
                          maxHeight: "100%",
                          objectFit: "contain",
                          display: "block",
                          margin: "0 auto",
                          background: "rgba(0,0,0,0.22)",
                          position: "relative",
                          zIndex: 1,
                        }}
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                      />
                    ) : null}
                  </div>

                  <div className={styles.meta}>
                    <div className={`${styles.title} ${styles.homeTitle}`} style={{ color: "var(--text-invert)" }}>
                      {title || "Untitled"}
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <div className={styles.rating} style={{ color: "var(--text-invert)" }}>
                        <div className={styles.ratingNum}>
                          {(() => {
                            const v = typeof (roulettePick as any).rating === "number" ? ((roulettePick as any).rating as number) : undefined;
                            return typeof v === "number" && Number.isFinite(v) ? v.toFixed(1) : "—";
                          })()}
                        </div>
                        <div className={styles.ratingStar}>★</div>
                      </div>
                    </div>

                    {plot ? (
                      <>
                        <div className={styles.divider} />
                        <div className={styles.homeMetaRow} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <div className={`${styles.overview} ${styles.homeOverview}`} style={{ color: "var(--text-invert)", flex: 1 }}>
                            {plot}
                          </div>
                        </div>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })()
        ) : null}
      </div>
    </div>
  );
});

RouletteSection.displayName = "RouletteSection";

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
