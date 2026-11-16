import { createHash } from "node:crypto";
import { Router } from "express";
import multer from "multer";
import { rateLimit } from "express-rate-limit";
import {
  createScan,
  findIdByImageHash,
  retryImageScan,
  getUserScan,
  deleteUserScan,
  listScans,
  toDto,
  toSummary,
} from "../../db/scans.js";
import { enqueueScan } from "../../queue/scanQueue.js";
import { scanId } from "../../lib/ulid.js";
import { pool } from "../../db/pool.js";
import { HttpError } from "../problem.js";
import { IMAGE_MIMES, validImage } from "../../providers/ocr/imageValidation.js";
import { runtimeSettings } from '../../db/settings.js';

// Hard ceiling only; the admin-set limit is enforced below in the handler.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 16 * 1024 * 1024, files: 1, fields: 1, fieldSize: 64 * 1024 },
});

export const scansRouter = Router();
scansRouter.get('/storage-policy', async (_req, res, next) => {
  try {
    const s = await runtimeSettings();
    res.json({ scanRetentionDays: s.scanRetentionDays, maxScansPerUser: s.maxScansPerUser });
  } catch (err) { next(err); }
});
const scanLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: async () => (await runtimeSettings()).scansPer15Min, keyGenerator: req => req.user!.id,
  standardHeaders: 'draft-7', legacyHeaders: false,
  handler: async (req, res) => {
    // Repeated hits flag abusive accounts on the admin dashboard.
    pool.query("UPDATE users SET scan_rate_hits = scan_rate_hits + 1 WHERE id = $1", [req.user!.id]).catch(() => {});
    const limit = (await runtimeSettings()).scansPer15Min;
    res.status(429).type('application/problem+json').json({ type: 'about:blank', title: 'Scan limit reached', status: 429, detail: `You can submit up to ${limit} scans every 15 minutes. Please try again later.` });
  },
});

scansRouter.post(
  "/scan",
  scanLimiter,
  (req, res, next) => {
    if (req.is("multipart/form-data")) return upload.any()(req, res, next);
    next();
  },
  async (req, res, next) => {
    try {
      const settings = await runtimeSettings();
      if (settings.maintenance) {
        throw new HttpError(503, "Under maintenance", "SafeText is paused for maintenance right now. Please try again later.");
      }
      if (req.is("application/json")) {
        if (req.body?.file !== undefined || req.body?.image !== undefined) {
          throw new HttpError(400, "Choose one input", "Submit text as JSON or a screenshot as multipart, not both.");
        }
        const text: unknown = req.body?.text;
        if (typeof text !== "string" || !text.trim()) {
          throw new HttpError(
            400,
            "Invalid request",
            'Body must be JSON with a non-empty "text" field.',
          );
        }
        if (text.length > 10_000) {
          throw new HttpError(
            400,
            "Invalid request",
            "Text is too long (max 10,000 characters).",
          );
        }
        const id = scanId();
        await createScan({ id, userId: req.user!.id, inputType: "text", inputText: text });
        enqueueScan(id);
        return res.status(202).json({ scanId: id });
      }

      if (req.is("multipart/form-data")) {
        if (req.body?.text !== undefined && (typeof req.body.text !== "string" || req.body.text.trim())) {
          throw new HttpError(400, "Choose one input", "Submit pasted SMS text or a screenshot, not both. Neither input was analyzed.");
        }
        const files = (req.files ?? []) as Express.Multer.File[];
        const file = files.find((f) => f.fieldname === "file") ?? files[0];
        if (!file) {
          throw new HttpError(
            400,
            "Invalid request",
            'Expected an image in the "file" field.',
          );
        }
        if (file.size > settings.maxUploadMb * 1024 * 1024) {
          throw new HttpError(413, "File too large", `Images up to ${settings.maxUploadMb} MB are supported.`);
        }
        if (!IMAGE_MIMES.includes(file.mimetype) || !validImage(file.buffer, file.mimetype)) {
          throw new HttpError(
            415,
            "Unsupported media type",
            `Upload a valid PNG, JPEG, WEBP, GIF, BMP or TIFF screenshot up to ${settings.maxUploadMb} MB.`,
          );
        }
        const hash = createHash("sha256").update(file.buffer).digest("hex");

        // Dedup returns the same scan; stale cleanup versions re-run analysis using saved OCR.
        const existing = await findIdByImageHash(hash, req.user!.id);
        if (existing) {
          if (await retryImageScan(existing, file.buffer)) enqueueScan(existing);
          return res.status(202).json({ scanId: existing, deduplicated: true });
        }
        const id = scanId();
        try {
          await createScan({
            id,
            userId: req.user!.id,
            inputType: "image",
            imageHash: hash,
            imageMime: file.mimetype,
            imageBytes: file.buffer,
          });
        } catch (err) {
          const code = (err as { code?: string })?.code;
          if (code === "23505") {
            const winner = await findIdByImageHash(hash, req.user!.id);
            if (winner) {
              if (await retryImageScan(winner, file.buffer)) enqueueScan(winner);
              return res.status(202).json({ scanId: winner, deduplicated: true });
            }
          }
          throw err;
        }
        enqueueScan(id);
        return res.status(202).json({ scanId: id });
      }

      throw new HttpError(
        415,
        "Unsupported media type",
        'Send application/json with a "text" field, or multipart/form-data with an image file.',
      );
    } catch (err) {
      next(err);
    }
  },
);

scansRouter.get("/scan/:id", async (req, res, next) => {
  try {
    const row = await getUserScan(req.params.id, req.user!.id);
    if (!row) {
      throw new HttpError(
        404,
        "Scan not found",
        `No scan with id ${req.params.id}.`,
      );
    }
    res.json(toDto(row));
  } catch (err) {
    next(err);
  }
});

// Owner-only verdict feedback; message text is stored only with consent.
scansRouter.post("/scan/:id/report", async (req, res, next) => {
  try {
    if (!req.is("application/json")) throw new HttpError(415, "Invalid request", "Send application/json.");
    const expected = req.body?.expectedVerdict;
    const share = req.body?.includeMessage === true;
    if (!["SAFE", "SUSPICIOUS", "MALICIOUS", "INCONCLUSIVE"].includes(expected)) {
      throw new HttpError(400, "Invalid request", "expectedVerdict must be SAFE, SUSPICIOUS, MALICIOUS or INCONCLUSIVE.");
    }
    const row = await getUserScan(req.params.id, req.user!.id);
    if (!row) throw new HttpError(404, "Scan not found", "The scan does not exist or is not in your history.");
    const shared = share ? (row.extracted_text ?? row.input_text ?? "").slice(0, 2000) || null : null;
    await pool.query(
      `INSERT INTO scan_reports(scan_id, user_id, expected_verdict, shared_text) VALUES($1, $2, $3, $4)
       ON CONFLICT(scan_id, user_id) DO UPDATE SET expected_verdict = $3, shared_text = $4, created_at = now()`,
      [req.params.id, req.user!.id, expected, shared]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

scansRouter.delete("/scan/:id", async (req, res, next) => {
  try {
    if (!await deleteUserScan(req.params.id, req.user!.id)) {
      throw new HttpError(404, "Scan not found", "The scan does not exist or is not in your history.");
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

scansRouter.get("/scans", async (req, res, next) => {
  try {
    const limit = Math.floor(Math.min(100, Math.max(1, Number(req.query.limit) || 50)));
    const rows = await listScans(limit, req.user!.id);
    res.json({ scans: rows.map(toSummary) });
  } catch (err) {
    next(err);
  }
});
