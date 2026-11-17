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
  progress?: "QUEUED" | "EXTRACTING" | "ANALYZING" | null;
  error?: string | null;
  scanId: string;
  status: ScanStatus;
  extraction: { text: string; note?: string } | null;
  riskyParts: { phrases: string[]; links: string[] };
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
    public retryAfter: number | null = null,
  ) {
    super(detail);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/api/v1/auth/")) {
      window.dispatchEvent(new Event("safetext:session-expired"));
    }
    let title = res.statusText;
    let detail = `Request failed (HTTP ${res.status}).`;
    try {
      const p = (await res.json()) as { title?: string; detail?: string };
      title = p.title ?? title;
      detail = p.detail ?? detail;
    } catch {
      // non-JSON error body — keep the defaults
    }
    const retryHeader = res.headers.get('Retry-After');
    const retrySeconds = retryHeader ? (/^\d+$/.test(retryHeader) ? Number(retryHeader)
      : Math.ceil((Date.parse(retryHeader) - Date.now()) / 1000)) : NaN;
    const retryAfter = Number.isFinite(retrySeconds) ? Math.max(1, retrySeconds) : null;
    if (res.status === 429 && retryAfter && !/\b(seconds?|minutes?|hours?)\b/i.test(detail)) {
      detail += ` Try again in ${retryAfter} seconds.`;
    }
    throw new ApiError(res.status, title, detail, retryAfter);
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
  return request<{ scans: ScanSummary[] }>("/api/v1/scans?limit=100");
}

export function storagePolicy() {
  return request<{ scanRetentionDays: number; maxScansPerUser: number }>('/api/v1/storage-policy');
}

export function deleteScan(id: string) {
  return request<{ ok: boolean }>(`/api/v1/scan/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export interface User { id: string; email: string; role: 'user' | 'admin' }
export interface AdminUser extends User {
  disabled: boolean;
  disabledReason: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  lastActiveAt: string | null;
  failedLogins: number;
  scanRateHits: number;
  authRateHits: number;
  resetRateHits: number;
  apiRateHits: number;
  rateLimitHits: number;
  scanCount: number;
}
export interface UserFilter { search: string; status: "" | "active" | "disabled"; from: string; to: string }
export function listUsers(offset = 0, filter?: UserFilter) {
  const params = new URLSearchParams({ limit: "20", offset: String(offset) });
  if (filter?.search) params.set("search", filter.search);
  if (filter?.status) params.set("status", filter.status);
  if (filter?.from) params.set("from", filter.from);
  if (filter?.to) params.set("to", filter.to);
  return request<{ users: AdminUser[] }>(`/api/v1/admin/users?${params}`);
}
export function setUserDisabled(id: string, disabled: boolean, confirmation: { password: string; reason?: string }) {
  return request<{ ok: boolean }>(`/api/v1/admin/users/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ disabled, password: confirmation.password, ...(confirmation.reason ? { reason: confirmation.reason } : {}) }),
  });
}
export function forceLogoutUser(id: string, reason = "") {
  return request<{ ok: boolean }>(`/api/v1/admin/users/${encodeURIComponent(id)}/force-logout`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reason ? { reason } : {}),
  });
}
export interface AdminOverview {
  totalUsers: number;
  scansToday: number;
  verdictsToday: { safe: number; suspicious: number; malicious: number; inconclusive: number };
  scamTrends7d: { category: string; count: number }[];
  topFlaggedDomains: { domain: string; hits: number }[];
  health: {
    failedToday: number;
    providers: { id: string; label: string; mode: string; failuresToday: number }[];
  };
}
export function getAdminOverview() { return request<AdminOverview>('/api/v1/admin/overview'); }
export interface AppStatus { maintenance: boolean; announcement: string }
export function getStatus() { return request<AppStatus>('/api/v1/status'); }
export function reportScan(id: string, expectedVerdict: string, includeMessage: boolean) {
  return request<{ ok: boolean }>(`/api/v1/scan/${encodeURIComponent(id)}/report`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expectedVerdict, includeMessage }),
  });
}
export interface DomainRule { domain: string; list: "block" | "allow"; created_at: string }
export function listDomains() { return request<{ rows: DomainRule[] }>('/api/v1/admin/domains'); }
export function addDomain(domain: string, list: "block" | "allow") {
  return request<DomainRule>('/api/v1/admin/domains', {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domain, list }),
  });
}
export function removeDomain(domain: string) {
  return request<{ ok: boolean }>(`/api/v1/admin/domains/${encodeURIComponent(domain)}`, { method: "DELETE" });
}
export interface Report { scanId: string; createdAt: string; email: string; reported: string | null; expected: string; shared: boolean; text: string | null }
export function listReports() {
  return request<{ rows: Report[]; falseAlarms: number; missedScams: number }>('/api/v1/admin/reports');
}
export interface AdminSettings { scansPer15Min: number; maxScansPerUser: number; scanRetentionDays: number; maxUploadMb: number; maintenance: boolean; announcement: string }
export function getAdminSettings() { return request<AdminSettings>('/api/v1/admin/settings'); }
export function saveAdminSettings(body: Partial<AdminSettings>) {
  return request<AdminSettings>('/api/v1/admin/settings', {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}
// targetEmail is null for actions that don't affect an account (domains, settings,
// exports); details then says what changed, e.g. "Retention (days): 30 → 14".
export interface AuditView {
  fields: { label: string; value: string; mono?: boolean }[];
  changes: { label: string; before: string; after: string }[];
  note: string | null;
}
// actorEmail is null for changes made from the server command line (admin:grant).
// view is a friendly, privacy-safe breakdown of the entry, built by the server.
export interface AuditEntry { id: number | string; actorEmail: string | null; targetEmail: string | null; action: string; reason: string | null; details: string | null; createdAt: string; view?: AuditView }
export interface AuditPage { audit: AuditEntry[]; total: number; page: number; pageSize: number }
export const AUDIT_PAGE_SIZE = 15;
export function listAudit(page = 1) {
  return request<AuditPage>(`/api/v1/admin/audit?page=${page}&pageSize=${AUDIT_PAGE_SIZE}`);
}
export async function downloadAuditCsv() {
  const res = await fetch('/api/v1/admin/audit?format=csv');
  if (!res.ok) throw new ApiError(res.status, res.statusText, 'Could not export the audit log.');
  const url = URL.createObjectURL(await res.blob());
  const link = Object.assign(document.createElement('a'), { href: url, download: 'safetext-audit.csv' });
  link.click();
  URL.revokeObjectURL(url);
}
export function currentUser() { return request<{ user: User }>("/api/v1/auth/me"); }
export function authenticate(action: "login" | "register", email: string, password: string) {
  return request<{ user: User }>(`/api/v1/auth/${action}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }),
  });
}
export function logout() {
  return request<{ ok: boolean }>("/api/v1/auth/logout", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
  });
}
export interface SessionInfo { id: string; device: string; signedInAt: string | null; current: boolean }
export function listSessions() { return request<{ sessions: SessionInfo[] }>("/api/v1/auth/sessions"); }
export function revokeSession(id: string) {
  return request<{ ok: boolean }>(`/api/v1/auth/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
}
export function changePassword(currentPassword: string, password: string) {
  return request<{ ok: boolean }>("/api/v1/auth/change-password", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword, password }),
  });
}
export function forgotPassword(email: string) {
  return request<{ ok: boolean; resendAfter?: number }>("/api/v1/auth/forgot-password", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }),
  });
}
export function verifyResetCode(email: string, code: string) {
  return request<{ ok: boolean }>("/api/v1/auth/verify-reset-code", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, code }),
  });
}
export function resetPassword(email: string, code: string, password: string) {
  return request<{ ok: boolean }>("/api/v1/auth/reset-password", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, code, password }),
  });
}
