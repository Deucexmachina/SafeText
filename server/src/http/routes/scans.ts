import { createHash } from "node:crypto";
import { Router } from "express";
import multer from "multer";
import {
  createScan,
  findIdByImageHash,
  getScan,
  listScans,
  toDto,
  toSummary,
} from "../../db/scans.js";
import { enqueueScan } from "../../queue/scanQueue.js";
import { scanId } from "../../lib/ulid.js";
import { HttpError } from "../problem.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
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
        await createScan({ id, inputType: "text", inputText: text });
        enqueueScan(id);
        return res.status(202).json({ scanId: id });
      }

      if (req.is("multipart/form-data")) {
        const files = (req.files ?? []) as Express.Multer.File[];
        const file = files.find((f) => f.fieldname === "file") ?? files[0];
        if (!file) {
          throw new HttpError(
            400,
            "Invalid request",
            'Expected an image in the "file" field.',
          );
        }
        if (!file.mimetype.startsWith("image/")) {
          throw new HttpError(
            415,
            "Unsupported media type",
            `Uploaded file must be an image, got ${file.mimetype}.`,
          );
        }
        const hash = createHash("sha256").update(file.buffer).digest("hex");

        // Dedup: same image content returns the existing scan, no new job.
        const existing = await findIdByImageHash(hash);
        if (existing) {
          return res.status(202).json({ scanId: existing, deduplicated: true });
        }
        const id = scanId();
        try {
          await createScan({
            id,
            inputType: "image",
            imageHash: hash,
            imageMime: file.mimetype,
            imageBytes: file.buffer,
          });
        } catch (err) {
          const code = (err as { code?: string })?.code;
          if (code === "23505") {
            const winner = await findIdByImageHash(hash);
            if (winner) {
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
    const row = await getScan(req.params.id);
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
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const rows = await listScans(limit);
    res.json({ scans: rows.map(toSummary) });
  } catch (err) {
    next(err);
  }
});
