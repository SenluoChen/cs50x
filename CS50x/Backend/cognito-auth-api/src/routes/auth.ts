import { Router } from "express";
import { env } from "../env.js";
import { clearAuthCookies, setAuthCookies } from "../cookies.js";
import {
  cognitoConfirm,
  cognitoConfirmForgotPassword,
  cognitoForgotPassword,
  cognitoLogin,
  cognitoRefresh,
  cognitoResendConfirmation,
  cognitoSignup,
} from "../cognito.js";
import { signMockJwt, verifyCognitoJwt, verifyMockJwt } from "../jwt.js";

export const authRouter = Router();

type Json = Record<string, any>;

function cognitoErrorMessage(err: any): string {
  return String(err?.message || err?.name || "Request failed");
}

function respondCognitoError(res: any, err: any) {
  const name = String(err?.name || "");
  const msg = cognitoErrorMessage(err);

  // Prefer stable, user-facing messages for common auth errors.
  if (name === "UserNotConfirmedException") return res.status(409).json({ error: "Account not confirmed. Please verify your email." } as Json);
  if (name === "NotAuthorizedException") return res.status(401).json({ error: "Invalid email or password" } as Json);
  if (name === "PasswordResetRequiredException") return res.status(409).json({ error: "Password reset required" } as Json);
  if (name === "UserNotFoundException") return res.status(404).json({ error: "User not found" } as Json);

  if (name === "CodeMismatchException") {
    return res.status(400).json({
      error:
        "Invalid code. If you clicked Resend code or tried Sign up again, only the latest email code works. Please check the newest email or tap Resend code.",
    } as Json);
  }
  if (name === "ExpiredCodeException") {
    return res.status(400).json({
      error:
        "Code expired. If you clicked Resend code or tried Sign up again, previous codes become invalid. Please tap Resend code and use the newest email.",
    } as Json);
  }

  if (name === "InvalidPasswordException") return res.status(400).json({ error: msg } as Json);
  if (name === "InvalidParameterException") return res.status(400).json({ error: msg } as Json);
  if (name === "LimitExceededException") return res.status(429).json({ error: "Too many attempts. Please try again later." } as Json);
  if (name === "TooManyRequestsException") return res.status(429).json({ error: "Too many requests. Please try again later." } as Json);

  // Fallback: surface original message, but avoid 500 for expected auth errors.
  return res.status(400).json({ error: msg } as Json);
}

function logCognitoError(action: string, err: any) {
  const name = String(err?.name || "");
  const msg = cognitoErrorMessage(err);
  const requestId = String(err?.$metadata?.requestId || "");
  const httpStatusCode = err?.$metadata?.httpStatusCode;
  console.warn(`[cognito:${action}] ${name}: ${msg}`, {
    requestId,
    httpStatusCode,
  });
}

function isAlreadyConfirmedError(err: any): boolean {
  const name = String(err?.name || "");
  const msg = String(err?.message || "").toLowerCase();
  if (name === "NotAuthorizedException" && msg.includes("current status") && msg.includes("confirmed")) return true;
  if (name === "InvalidParameterException" && msg.includes("already") && msg.includes("confirmed")) return true;
  if (name === "InvalidParameterException" && msg.includes("current status") && msg.includes("confirmed")) return true;
  return false;
}

function asyncHandler<TReq = any, TRes = any>(
  fn: (req: TReq, res: TRes, next: any) => Promise<any>
): (req: TReq, res: TRes, next: any) => void {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function normalizeEmail(email: string) {
  return String(email || "").trim().toLowerCase();
}

function getCookie(req: any, name: string): string {
  return String(req?.cookies?.[name] || "");
}

function mockUserStore() {
  const g = globalThis as any;
  if (!g.__PC_MOCK_USERS__) g.__PC_MOCK_USERS__ = new Map<string, { email: string; password: string; createdAt: number }>();
  return g.__PC_MOCK_USERS__ as Map<string, { email: string; password: string; createdAt: number }>;
}

async function mockIssueCookies(res: any, email: string) {
  const idToken = await signMockJwt({ email }, { tokenUse: "id", expiresInSec: 60 * 60 });
  const accessToken = await signMockJwt({ email }, { tokenUse: "access", expiresInSec: 60 * 60 });
  // refresh token for mock: reuse a longer-lived access-like token
  const refreshToken = await signMockJwt({ email }, { tokenUse: "access", expiresInSec: 30 * 24 * 60 * 60 });
  setAuthCookies(res, { idToken, accessToken, refreshToken });
}

authRouter.post(
  "/signup",
  asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");
  if (!email) return res.status(400).json({ error: "Email is required" } as Json);
  if (!password) return res.status(400).json({ error: "Password is required" } as Json);

  if (env.authMode === "mock") {
    const users = mockUserStore();
    if (users.has(email)) return res.status(400).json({ error: "This email is already registered" } as Json);
    users.set(email, { email, password, createdAt: Date.now() });
    // mock: no confirm required
    return res.json({ ok: true, userConfirmed: true, next: "done" } as Json);
  }

  try {
    const out = await cognitoSignup(email, password);
    // Cognito may require confirm code
    return res.json({
      ok: true,
      userConfirmed: Boolean(out.UserConfirmed),
      userSub: out.UserSub,
      next: out.UserConfirmed ? "done" : "confirm",
    } as Json);
  } catch (e: any) {
    logCognitoError("signup", e);
    // Important UX: if the user already exists but is NOT confirmed yet,
    // treat signup as "confirm" and resend the code so the existing frontend
    // confirm screen can still be used (without changing UI).
    const name = String(e?.name || "");
    if (name === "UsernameExistsException") {
      try {
        await cognitoResendConfirmation(email);
        return res.json({ ok: true, userConfirmed: false, next: "confirm" } as Json);
      } catch (e2: any) {
        logCognitoError("resend-after-username-exists", e2);
        // If user is already confirmed, Cognito often rejects resend with a 400.
        const n2 = String(e2?.name || "");
        const m2 = String(e2?.message || "");
        const alreadyConfirmed = n2 === "InvalidParameterException" && m2.toLowerCase().includes("already") && m2.toLowerCase().includes("confirmed");
        if (alreadyConfirmed) return res.status(400).json({ error: "This email is already registered" } as Json);
        return respondCognitoError(res, e2);
      }
    }

    return respondCognitoError(res, e);
  }
  })
);

authRouter.post(
  "/confirm",
  asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const code = String(req.body?.code || "").trim().replace(/[\s-]+/g, "");
  if (!email) return res.status(400).json({ error: "Email is required" } as Json);
  if (!code) return res.status(400).json({ error: "Code is required" } as Json);

  if (env.authMode === "mock") {
    // mock: always confirmed
    return res.json({ ok: true } as Json);
  }

  try {
    await cognitoConfirm(email, code);
    res.json({ ok: true } as Json);
  } catch (e: any) {
    logCognitoError("confirm", e);
    // Make confirmation idempotent: if the user is already confirmed, treat it as success.
    if (isAlreadyConfirmedError(e)) return res.json({ ok: true } as Json);
    return respondCognitoError(res, e);
  }
  })
);

authRouter.post(
  "/resend",
  asyncHandler(async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    if (!email) return res.status(400).json({ error: "Email is required" } as Json);

    if (env.authMode === "mock") {
      return res.json({ ok: true } as Json);
    }

    try {
      await cognitoResendConfirmation(email);
      return res.json({ ok: true } as Json);
    } catch (e: any) {
      logCognitoError("resend", e);
      return respondCognitoError(res, e);
    }
  })
);

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");
  if (!email) return res.status(400).json({ error: "Email is required" } as Json);
  if (!password) return res.status(400).json({ error: "Password is required" } as Json);

  if (env.authMode === "mock") {
    const users = mockUserStore();
    const u = users.get(email);
    if (!u || u.password !== password) return res.status(401).json({ error: "Invalid email or password" } as Json);
    await mockIssueCookies(res, email);
    return res.json({ ok: true, user: { email, createdAt: u.createdAt } } as Json);
  }

  try {
    const auth = await cognitoLogin(email, password);
    const accessToken = auth?.AccessToken;
    const idToken = auth?.IdToken;
    const refreshToken = auth?.RefreshToken;

    if (!accessToken || !idToken) {
      return res.status(401).json({ error: "Login failed" } as Json);
    }

    setAuthCookies(res, { accessToken, idToken, refreshToken });

    const verified = await verifyCognitoJwt(idToken, "id");
    const user = { email: String((verified.claims as any).email || email), createdAt: Date.now() };
    return res.json({ ok: true, user } as Json);
  } catch (e: any) {
    logCognitoError("login", e);
    return respondCognitoError(res, e);
  }
  })
);

authRouter.post(
  "/refresh",
  asyncHandler(async (req, res) => {
  const refreshToken = getCookie(req, env.cookieNameRefresh);
  const idToken = getCookie(req, env.cookieNameId);

  if (env.authMode === "mock") {
    if (!refreshToken) return res.status(401).json({ error: "No refresh token" } as Json);
    try {
      const v = await verifyMockJwt(refreshToken);
      const email = normalizeEmail(String((v.claims as any).email || ""));
      if (!email) return res.status(401).json({ error: "Refresh failed" } as Json);
      await mockIssueCookies(res, email);
      return res.json({ ok: true, user: { email, createdAt: Date.now() } } as Json);
    } catch {
      return res.status(401).json({ error: "Refresh failed" } as Json);
    }
  }

  // Need an email to compute SECRET_HASH when client secret exists.
  // We can get it from id token if present; otherwise refresh may still work if client has no secret.
  let email = "";
  if (idToken) {
    try {
      const verified = await verifyCognitoJwt(idToken, "id");
      email = normalizeEmail(String((verified.claims as any).email || ""));
    } catch {
      // ignore
    }
  }

  if (!refreshToken) return res.status(401).json({ error: "No refresh token" } as Json);
  if (env.clientSecret && !email) return res.status(401).json({ error: "Cannot refresh session" } as Json);

  try {
    const auth = await cognitoRefresh(email, refreshToken);
    const nextAccess = auth?.AccessToken;
    const nextId = auth?.IdToken;

    if (!nextAccess || !nextId) return res.status(401).json({ error: "Refresh failed" } as Json);

    // Cognito usually does not return RefreshToken on refresh.
    setAuthCookies(res, { accessToken: nextAccess, idToken: nextId });

    const verified = await verifyCognitoJwt(nextId, "id");
    const user = { email: String((verified.claims as any).email || email), createdAt: Date.now() };
    return res.json({ ok: true, user } as Json);
  } catch (e: any) {
    logCognitoError("refresh", e);
    return respondCognitoError(res, e);
  }
  })
);

authRouter.post(
  "/forgot",
  asyncHandler(async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    if (!email) return res.status(400).json({ error: "Email is required" } as Json);

    if (env.authMode === "mock") {
      // mock: behave like email has been sent
      return res.json({ ok: true } as Json);
    }

    try {
      await cognitoForgotPassword(email);
      return res.json({ ok: true } as Json);
    } catch (e: any) {
      logCognitoError("forgot", e);
      return respondCognitoError(res, e);
    }
  })
);

authRouter.post(
  "/reset",
  asyncHandler(async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const code = String(req.body?.code || "").trim().replace(/[\s-]+/g, "");
    const newPassword = String(req.body?.newPassword || "");
    if (!email) return res.status(400).json({ error: "Email is required" } as Json);
    if (!code) return res.status(400).json({ error: "Code is required" } as Json);
    if (!newPassword) return res.status(400).json({ error: "New password is required" } as Json);

    if (env.authMode === "mock") {
      return res.json({ ok: true } as Json);
    }

    try {
      await cognitoConfirmForgotPassword(email, code, newPassword);
      return res.json({ ok: true } as Json);
    } catch (e: any) {
      logCognitoError("reset", e);
      return respondCognitoError(res, e);
    }
  })
);

authRouter.post("/logout", async (_req, res) => {
  clearAuthCookies(res);
  res.json({ ok: true } as Json);
});

authRouter.get("/me", async (req, res) => {
  const idToken = getCookie(req, env.cookieNameId);
  if (!idToken) return res.status(401).json({ error: "Not authenticated" } as Json);

  try {
    const verified = env.authMode === "mock" ? await verifyMockJwt(idToken, "id") : await verifyCognitoJwt(idToken, "id");
    res.json({
      ok: true,
      user: {
        email: String((verified.claims as any).email || ""),
        createdAt: Date.now(),
      },
    } as Json);
  } catch {
    return res.status(401).json({ error: "Not authenticated" } as Json);
  }
});
