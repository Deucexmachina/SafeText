import type { Response } from "express";

// RFC 7807 problem details.
export class HttpError extends Error {
  readonly status: number;
  readonly title: string;
  readonly detail: string;
  readonly type: string;

  constructor(status: number, title: string, detail: string, type = "about:blank") {
    super(detail);
    this.status = status;
    this.title = title;
    this.detail = detail;
    this.type = type;
  }
}

export function sendProblem(
  res: Response,
  status: number,
  title: string,
  detail: string,
  type = "about:blank",
): void {
  res
    .status(status)
    .type("application/problem+json")
    .json({ type, title, status, detail });
}
