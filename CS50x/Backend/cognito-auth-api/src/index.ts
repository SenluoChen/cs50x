import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

import { env } from "./env.js";
import { authRouter } from "./routes/auth.js";
import { favoritesRouter } from "./routes/favorites.js";

const app = express();

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow non-browser requests (curl/postman) with no origin
      if (!origin) return callback(null, true);

      // Mock mode is used for local dev/demo environments. In these cases we prefer
      // reliability over strict origin allow-listing so the frontend never hits an
      // opaque "Failed to fetch" due to a missing/mismatched Origin.
      if (env.authMode === 'mock') return callback(null, true);

      // Exact-match allow-list
      if (Array.isArray(env.frontendOrigins) && env.frontendOrigins.indexOf(origin) !== -1) return callback(null, true);
      return callback(new Error('Not allowed by CORS'), false);
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "256kb" }));
app.use(cookieParser());

// Simple request logger to help verify incoming requests from the frontend/dev proxy
app.use((req, _res, next) => {
  // eslint-disable-next-line no-console
  console.log(`[auth] ${new Date().toISOString()} ${req.method} ${req.originalUrl} from ${req.ip}`);
  next();
});
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/auth", authRouter);

app.use("/favorites", favoritesRouter);

app.use((err: any, _req: any, res: any, _next: any) => {
  // eslint-disable-next-line no-console
  console.error(err);
  const msg = String(err?.message || "Server error");
  const status = Number(err?.status || err?.statusCode || 500);
  res.status(Number.isFinite(status) && status >= 400 ? status : 500).json({ error: msg });
});

app.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`cognito-auth-api listening on http://localhost:${env.port}`);
});
