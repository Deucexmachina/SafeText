export type ScanStatus = "RUNNING" | "COMPLETE" | "PARTIAL" | "INCONCLUSIVE";
export type Verdict = "SAFE" | "SUSPICIOUS" | "MALICIOUS" | "INCONCLUSIVE";

export interface Entities {
  senderId: string | null;
  urls: string[];
  phoneNumbers: string[];
}

export interface Analysis {
  verdict: Verdict;
  confidence: number;
  reasons: string[];
  entities: Entities;
}

export interface ThreatUrl {
  url: string;
  threat: string | null;
}

export interface ScanResult {
  scanId: string;
  status: ScanStatus;
  extraction: { text: string } | null;
  analysis: Analysis | null;
  threatIntel: { urls: ThreatUrl[] } | null;
  incomplete: string[];
  createdAt: string;
}

export interface ScanSummary {
  scanId: string;
  status: ScanStatus;
  inputType: "text" | "image";
  verdict: Verdict | null;
  confidence: number | null;
  preview: string | null;
  createdAt: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public title: string,
    public detail: string,
  ) {
    super(detail);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    let title = res.statusText;
    let detail = `Request failed (HTTP ${res.status}).`;
    try {
      const p = (await res.json()) as { title?: string; detail?: string };
      title = p.title ?? title;
      detail = p.detail ?? detail;
    } catch {
      // non-JSON error body — keep the defaults
    }
    throw new ApiError(res.status, title, detail);
  }
  return res.json() as Promise<T>;
}

export function submitText(text: string) {
  return request<{ scanId: string }>("/api/v1/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

export function submitImage(file: File) {
  const fd = new FormData();
  fd.append("file", file);
  return request<{ scanId: string; deduplicated?: boolean }>("/api/v1/scan", {
    method: "POST",
    body: fd,
  });
}

export function getScan(id: string) {
  return request<ScanResult>(`/api/v1/scan/${encodeURIComponent(id)}`);
}

export function listScans() {
  return request<{ scans: ScanSummary[] }>("/api/v1/scans");
}
