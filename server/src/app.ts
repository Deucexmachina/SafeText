import express from "express";
import multer from "multer";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { maintainStorage } from './db/retention.js';
import { activeAnnouncement, runtimeSettings } from './db/settings.js';
import { scansRouter } from "./http/routes/scans.js";
import { HttpError, sendProblem } from "./http/problem.js";
import { authRouter, checkOrigin, requireAuth } from "./http/auth.js";
import { adminRouter } from "./http/routes/admin.js";
import { apiLimiter, recordRateHit } from './http/rateLimits.js';

export function createApp() {
  const app = express();
  const webRoot = fileURLToPath(new URL("../../web/dist/", import.meta.url));
  if (config.serveWeb && !existsSync(`${webRoot}/index.html`)) {
    throw new Error("SERVE_WEB requires a frontend build. Run npm run build first.");
  }
  app.disable("x-powered-by");
  app.set('trust proxy', false);
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/api/v1', (req, res, next) => req.path === '/health' && ['GET', 'HEAD'].includes(req.method) ? next() : apiLimiter(req, res, next));
  app.use(express.json({ limit: "64kb" }));
  app.use("/api/v1", checkOrigin);
  app.use('/api/v1', (req, _res, next) => {
    if (req.path === '/health' && ['GET', 'HEAD'].includes(req.method)) return next();
    void maintainStorage().then(() => next(), next);
  });

  app.get("/api/v1/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/api/v1/status", async (_req, res, next) => {
    try {
      const s = await runtimeSettings();
      // An announcement past its end time is no longer sent to users.
      const active = activeAnnouncement(s);
      res.json({ maintenance: s.maintenance, announcement: active.text, announcementType: active.type, announcementUntil: active.until });
    } catch (err) { next(err); }
  });
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/admin", requireAuth, adminRouter);
  app.use("/api/v1", requireAuth, (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  }, scansRouter);

  // Keep API failures as problem JSON, including when serving the SPA below.
  app.use("/api", (_req, res) => {
    sendProblem(res, 404, "Not found", "The requested API route does not exist.");
  });

  if (config.serveWeb) {
    app.use((_req, res, next) => {
      // The confidence bar uses an inline style. Scripts and API calls stay same-origin.
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
      next();
    });
    app.use(express.static(webRoot));
    app.get("*", (req, res, next) => {
      // Missing assets must not receive index.html with a misleading 200 response.
      if (req.path.startsWith('/assets/') || !req.accepts('html')) return next();
      res.sendFile(`${webRoot}/index.html`);
    });
  }

  app.use((_req, res) => {
    sendProblem(res, 404, "Not found", "The requested route does not exist.");
  });

  app.use(
    (
      err: unknown,
      req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (err instanceof HttpError) {
        if (err.status === 429) {
          if (!res.hasHeader('Retry-After')) res.setHeader('Retry-After', '60');
          const recorded = req.path === '/api/v1/scan' ? recordRateHit(req, 'scan')
            : req.path === '/api/v1/auth/reset-password' ? recordRateHit(req, 'reset', true) : Promise.resolve();
          void recorded.then(() => sendProblem(res, err.status, err.title, err.detail, err.type));
          return;
        }
        return sendProblem(res, err.status, err.title, err.detail, err.type);
      }
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return sendProblem(
            res,
            413,
            "File too large",
            "Images up to 8 MB are supported.",
          );
        }
        return sendProblem(res, 400, "Invalid upload", err.message);
      }
      if (err instanceof SyntaxError) {
        return sendProblem(
          res,
          400,
          "Malformed JSON",
          "Request body is not valid JSON.",
        );
      }
      if ((err as { status?: number })?.status === 413) return sendProblem(res, 413, 'Request too large', 'The request body exceeds the allowed size.');
      if ((err as { status?: number })?.status === 415) return sendProblem(res, 415, 'Unsupported encoding', 'Use a supported request encoding.');
      // Never log request bodies, query parameters, provider payloads or secrets.
      console.error('Request failed', { name: err instanceof Error ? err.name : 'UnknownError' });
      sendProblem(
        res,
        500,
        "Internal server error",
        "Something went wrong while handling the request.",
      );
    },
  );

  return app;
}
