# SafeText

Checks whether an SMS message is a scam. Paste a message or upload a
screenshot, and SafeText returns a verdict — **Safe**, **Suspicious**, or
**Malicious** — with a confidence score, a list of reasons, and the details it
extracted (sender ID, links, phone numbers).

## Tech stack

| Piece    | What                                        |
| -------- | ------------------------------------------- |
| Frontend | React + TypeScript (Vite), `web/`           |
| Backend  | Node.js + TypeScript (Express), `server/`   |
| Database | PostgreSQL 16 via Docker Compose            |
| Queue    | In-process job queue inside the backend     |

All external providers (OCR, scam analysis, URL threat intel) are called from
the backend only, behind stubbed adapters — no real API integrations yet.

## Prerequisites

- **Node.js 20+** and npm — <https://nodejs.org>
- **Docker Desktop** (for PostgreSQL) — <https://www.docker.com/products/docker-desktop>

## Setup

### 1. Start PostgreSQL

From the repo root:

```bash
docker compose up -d
```

This starts Postgres on `localhost:5432` with user/password/db all set to
`safetext` (see `docker-compose.yml`). To use different credentials, copy
`.env.example` to `.env` and edit it first.

### 2. Install and start the backend

```bash
cd server
npm install
cp .env.example .env   # optional — defaults already match docker-compose
npm run dev
```

The server:

- applies the DB schema automatically on boot (`src/db/schema.sql`)
- listens on **<http://localhost:3001>**

### 3. Install and start the frontend

In a second terminal:

```bash
cd web
npm install
npm run dev
```

Vite serves the app on **<http://localhost:5173>** and proxies `/api` to the
backend on port 3001.

Open <http://localhost:5173> in a browser.

## Using the app

- **Scan** page: paste an SMS into the textarea, or click *Choose image* to
  upload a screenshot, then press **Check message**. The UI polls the API every
  2 s until the scan finishes.
- **History** page: lists previous scans; click a row to view its result.

## API

Base URL: `http://localhost:3001/api/v1`

| Method | Path         | Purpose                                             |
| ------ | ------------ | --------------------------------------------------- |
| POST   | `/scan`      | Submit a scan. Returns `202` + `{ "scanId": "..." }` |
| GET    | `/scan/:id`  | Get scan status + result                            |
| GET    | `/scans`     | History list (`?limit=`, default 50)                |
| GET    | `/health`    | Liveness check                                      |

Submit either JSON text or a multipart image:

```bash
# pasted text
curl -X POST http://localhost:3001/api/v1/scan \
  -H "Content-Type: application/json" \
  -d '{"text":"GCash: your account is suspended. Verify now: https://gcash-verify.top"}'

# screenshot (multipart field name: "file")
curl -X POST http://localhost:3001/api/v1/scan \
  -F "file=@screenshot.png;type=image/png"

# poll the result
curl http://localhost:3001/api/v1/scan/scn_01J...
```

`status` is `RUNNING` while the job moves through
`QUEUED → EXTRACTING → ANALYZING`, then `COMPLETE`, `PARTIAL`, or
`INCONCLUSIVE`. Re-uploading the same image bytes returns the existing scan
(SHA-256 dedup). Errors use RFC 7807 (`type`, `title`, `status`, `detail`) with
`application/problem+json`.

## Provider adapters (stubbed)

Each integration lives behind an interface so the real provider is a one-file
swap later. Wiring is in `server/src/providers/index.ts`.

| Interface        | Stub behavior                                             | Real provider later   |
| ---------------- | --------------------------------------------------------- | --------------------- |
| `OcrProvider`    | Returns canned SMS text for image uploads                 | LLM Whisperer         |
| `ScamAnalyzer`   | Heuristic scoring: urgency, brand names, links, prizes    | Kimi                  |
| `UrlThreatIntel` | Flags risky TLDs, brand lookalikes, shorteners            | Google Safe Browsing  |

Real API keys are read from server env vars (`.env.example`):
`LLM_WHISPERER_API_KEY`, `KIMI_API_KEY`, `GOOGLE_SAFE_BROWSING_API_KEY`. They
are unused while the stubs are active.

## Useful commands

```bash
# backend
cd server
npm run dev          # dev server with auto-reload (tsx watch)
npm run typecheck    # type-check only
npm run build        # compile to dist/
npm run start        # run compiled server
npm run migrate      # apply schema.sql manually

# frontend
cd web
npm run dev          # vite dev server
npm run build        # type-check + production build

# database
docker compose down          # stop postgres
docker compose down -v       # stop and DELETE all scan data
```

## Project layout

```
├── docker-compose.yml   # PostgreSQL
├── server/              # Express API + job queue + stub providers
│   └── src/
│       ├── db/          # pool, schema, scan records
│       ├── domain/      # types, URL/phone/brand extraction
│       ├── http/        # routes, RFC 7807 errors
│       ├── providers/   # OcrProvider / ScamAnalyzer / UrlThreatIntel
│       └── queue/       # in-process scan pipeline
└── web/                 # React app (Scan, History, result card)
    └── src/
        ├── components/  # ResultCard, VerdictBadge
        └── pages/       # ScanPage, HistoryPage, ScanDetailPage
```

## Troubleshooting

- **`docker compose up` can't pull the image** — if the Docker Hub CDN is
  unreachable, pull through a mirror and tag it:
  `docker pull mirror.gcr.io/library/postgres:16.4-alpine && docker tag mirror.gcr.io/library/postgres:16.4-alpine postgres:16.4-alpine`
- **Server fails to start with a DB error** — make sure `docker compose up -d`
  is running and `DATABASE_URL` in `server/.env` matches the compose credentials.
- **Blank page / API errors in the UI** — confirm the backend is on `:3001`
  (`curl http://localhost:3001/api/v1/health` should return `{"status":"ok"}`).
