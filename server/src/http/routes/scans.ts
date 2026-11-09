import { createHash } from "node:crypto";
import { Router } from "express";
import multer from "multer";
import {
  createScan,
  findIdByImageHash,
  retryImageScan,
  getUserScan,
  listScans,
  toDto,
  toSummary,
} from "../../db/scans.js";
import { enqueueScan } from "../../queue/scanQueue.js";
import { scanId } from "../../lib/ulid.js";
import { HttpError } from "../problem.js";
import { IMAGE_MIMES, validImage } from "../../providers/ocr/imageValidation.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 1, fieldSize: 64 * 1024 },
});

export const scansRouter = Router();

scansRouter.post(
  "/scan",
  (req, res, next) => {
    if (req.is("multipart/form-data")) return upload.any()(req, res, next);
    next();
  },
  async (req, res, next) => {
    try {
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
        if (!IMAGE_MIMES.includes(file.mimetype) || !validImage(file.buffer, file.mimetype)) {
          throw new HttpError(
            415,
            "Unsupported media type",
            "Upload a valid PNG, JPEG, WEBP, GIF, BMP or TIFF screenshot up to 8 MB.",
          );
        }
        const hash = createHash("sha256").update(file.buffer).digest("hex");

        // Dedup: same image content returns the existing scan, no new job.
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

scansRouter.get("/scans", async (req, res, next) => {
  try {
    const limit = Math.floor(Math.min(100, Math.max(1, Number(req.query.limit) || 50)));
    const rows = await listScans(limit, req.user!.id);
    res.json({ scans: rows.map(toSummary) });
  } catch (err) {
    next(err);
  }
});
