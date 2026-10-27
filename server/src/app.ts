import express from "express";
import multer from "multer";
import { scansRouter } from "./http/routes/scans.js";
import { HttpError, sendProblem } from "./http/problem.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb" }));

  app.get("/api/v1/health", (_req, res) => res.json({ status: "ok" }));
  app.use("/api/v1", scansRouter);

  app.use((_req, res) => {
    sendProblem(res, 404, "Not found", "The requested route does not exist.");
  });

  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (err instanceof HttpError) {
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
      console.error(err);
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
