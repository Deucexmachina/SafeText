# SafeText

Check an SMS for signs of a scam. Register or log in, paste a message or upload
a screenshot, and review the verdict and your private scan history.

The app uses React/TypeScript (Vite), Node.js/TypeScript (Express), and PostgreSQL 16.
Accounts, sessions, and scans persist in PostgreSQL. The in-process scan queue
resumes unfinished jobs when the backend restarts.

Scam analysis uses the Kimi API and URL checks use Google Safe Browsing —
see **Provider API keys** below. Screenshot OCR uses LLMWhisperer v2; pasted
text goes directly to analysis without OCR.

## Requirements

- Node.js 22 or newer and npm: <https://nodejs.org>
- Docker Desktop running **Linux containers**: <https://docs.docker.com/desktop/setup/install/windows-install/>

This is a JavaScript/TypeScript project. `server/package.json` and `web/package.json`
list dependencies, and their `package-lock.json` files pin installed versions.
There is no Python dependency or `requirements.txt` file to install.

## Setup (PowerShell, Windows)

Copy only commands inside the blocks. Lines containing three backticks and a
language name are Markdown formatting, not commands. Do not copy `PS C:\...>` either.

1. Open **Docker Desktop** from the Start menu. Finish initial setup if asked and
   wait for its engine to start. In the tray menu, choose **Switch to Linux containers**
   if shown. If the menu offers **Switch to Windows containers**, Linux mode is already active.
   Confirm the engine is reachable:

   ```powershell
   docker info
   ```

2. In PowerShell, from the repository root:

   ```powershell
   npm run setup
   npm run db:up
   npm run dev
   ```

   Setup installs both apps using `npm ci` and creates missing `.env` files without
   overwriting existing ones. `db:up` waits for healthy PostgreSQL. `dev` starts both
   apps together. Keep the terminal open; Ctrl+C stops the apps.

3. Open **<http://localhost:5173>**, choose **Create an account**, and register with
   an email and password of 12 to 128 characters. Registration logs you in.
   Scan messages, view History, and log out using the header.

Run setup only while the dev servers are stopped. To reinstall, press Ctrl+C in
the dev terminal first, then run `npm run setup` and `npm run dev` again.

The npm commands also work in macOS/Linux terminals once Docker is running.
To run the apps separately, open two terminals from the repository root:

```powershell
npm --prefix server run dev
```

```powershell
npm --prefix web run dev
```

## Configuration and storage

- Root `.env` configures Docker Compose's `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB`.
- `server/.env` configures `DATABASE_URL`, `PORT`, and `APP_ORIGIN` for the API.
  If changing database credentials, update both files. PostgreSQL initialization
  variables apply only to a new empty data volume; editing `.env` does not change
  a password in an existing database.
- The default database URL is `postgres://safetext:safetext@localhost:5432/safetext`.
  These credentials are for local development. The database port binds to localhost.
- The schema applies automatically when the backend starts. To apply it manually:
  `npm --prefix server run migrate`. Schema changes run in a transaction and can be reapplied.
- Docker stores data in the named `pgdata` volume. `npm run db:down` stops PostgreSQL
  without deleting data. **`docker compose down -v` deletes all accounts and scans.**
- Old anonymous scans remain stored without an owner and are hidden from all accounts.
  They are not assigned to the first person who registers.

### Provider API keys

Configure providers in `server/.env` to enable live scanning. Restart the backend
after changing these settings. Empty keys do not enable a demo verdict.

- `LLM_WHISPERER_API_KEY` — required only for screenshot OCR.
- `LLM_WHISPERER_BASE_URL` — full regional v2 API base URL. Defaults to
  `https://llmwhisperer-api.us-central.unstract.com/api/v2`. For an EU account use
  `https://llmwhisperer-api.eu-west.unstract.com/api/v2`. Match the region of
  the key; there is no automatic region switching.

- `KIMI_API_KEY` — analyzes SMS text via Kimi's OpenAI-compatible Chat
  Completions API (`https://api.moonshot.ai/v1`). Create a key in the
  Moonshot AI platform console. `KIMI_MODEL` optionally overrides the
  default model (`kimi-k3`).
- `GOOGLE_SAFE_BROWSING_API_KEY` — checks extracted URLs with the Safe
  Browsing Lookup API v4 (`threatMatches:find`). Create a key in Google
  Cloud Console with the Safe Browsing API enabled.

Keys are read server-side only and are never sent to the frontend. A missing
key makes only that provider fail with a clear error: scans still complete
as `PARTIAL` or `INCONCLUSIVE` rather than crashing.

Use **one input per scan**. Text plus an image is rejected with a validation
message instead of silently dropping the text. Screenshot formats are PNG,
JPEG, WEBP, GIF, BMP, and TIFF, with a maximum size of 8 MB. The backend checks
the MIME type and file signature before submitting raw binary bytes to OCR.
OCR uses a bounded 120-second deadline and at most 30 status polls. Unreadable
or empty extraction is INCONCLUSIVE and is never sent to Kimi.

One-time OCR output is saved before analysis starts, and screenshot bytes are
removed after extraction or terminal failure. Re-uploading a successful image
returns its saved result; re-uploading a failed/partial image retries that scan,
reusing readable saved text. Restarted jobs likewise reuse saved extraction.
Only image text marked as LLMWhisperer v2 extraction is eligible for reuse.
Legacy screenshot results (including the former canned OCR samples) are shown
as unverified and cannot supply analysis or history previews. Re-uploading the
same screenshot forces fresh OCR and replaces that scan's unverified result.
The migration does not infer provenance from message contents or delete history.
The UI displays queue/extraction/analysis progress and sanitized provider errors.
The scan response adds `progress` and `error` without changing existing routes
or fields. `incomplete` continues to use `extraction`, `analysis`, `threat_intel`.

Kimi K3 always uses reasoning, so its request reserves completion tokens for
reasoning plus JSON and uses low reasoning effort. The output is validated
locally; malformed, truncated, or refused output is retried once, then disclosed
as incomplete. Safe Browsing checks the union of locally extracted URLs and
Kimi URL entities, including local candidates when Kimi fails. A partial result
cannot claim SAFE; a flagged URL still forces MALICIOUS with confidence >= 90.

Provider contracts: [LLMWhisperer extraction](https://docs.unstract.com/llmwhisperer/llm_whisperer/apis/llm_whisperer_text_extraction_api/),
[status](https://docs.unstract.com/llmwhisperer/llm_whisperer/apis/llm_whisperer_text_extraction_status_api/),
[one-time retrieval](https://docs.unstract.com/llmwhisperer/llm_whisperer/apis/llm_whisperer_text_extraction_retrieve_api/),
[supported formats](https://docs.unstract.com/llmwhisperer/llm_whisperer/list_of_file_types_supported/),
and [Kimi K3](https://platform.kimi.ai/docs/guide/kimi-k3-quickstart).

- Image deduplication is per account. Uploading identical bytes in another account
  creates a separate scan. Other accounts cannot access your scans by their IDs.

Passwords use salted scrypt hashes. Sessions last seven days, using random tokens
in HttpOnly, SameSite cookies; the database stores only token hashes. Logout revokes
the session. Login and registration share a limit of 20 attempts per IP and per
account email per 15 minutes; the database-backed limit survives API restarts.

Browser writes must match `APP_ORIGIN` (default `http://localhost:5173`). Use that exact
URL locally. Vite stays on port 5173 so it cannot silently change origins.
For deployment, use HTTPS, set `NODE_ENV=production` to enable Secure cookies,
set `APP_ORIGIN` to the public origin, and serve the frontend and `/api` from that
same origin. Email verification, password resets, and multi-factor authentication
are not implemented.

## Roles and administrator setup

Every account starts as `user`, including the first registered account. There
can be one `admin`, enforced by a database index. Registration/login cannot set
roles. Existing accounts remain users after the migration. To make a trusted
existing account the admin, run this locally from the project root:

```powershell
npm.cmd --prefix server run admin:grant -- your-admin-account@example.com
```

Register that account first and choose its password in the app; there is no
default admin password or public promotion endpoint. The command revokes that
account's sessions; sign in again to see the **Admin** tab. It refuses to grant
a second administrator. Never auto-promote the first visitor or grant admin
based only on a public registration email, because email ownership is not verified.

The admin can list accounts with scan counts and enable/disable ordinary users.
Disabling revokes sessions and blocks login; enabling requires a fresh login.
Access changes are recorded in `admin_audit` with actor, target, action and UTC
timestamp. Admin access does not grant permission to read/delete other users'
messages. Role and disabled status are checked against the database on every
authenticated request. The admin cannot disable their own account in the UI.

## Security review and deployment limits

The review covered session authentication, role checks, scan ownership, upload
validation, provider credentials, query parameterization, error output, abuse
limits and npm dependency advisories. Automated tests cover privilege escalation,
cross-account access/deletion, session revocation and concurrent queue admission.
This is a targeted code review and regression suite, not a penetration-test certification.

- Authentication throttles IPs and account emails at 20 attempts per 15 minutes
  using hashed keys in PostgreSQL, surviving restarts and multiple processes.
- Scan submission is limited to 20 requests per account per 15 minutes in each
  API process. Queue admission is enforced transactionally in PostgreSQL: at
  most three active scans per account and 100 globally. For multiple API
  instances, use a shared scan-rate-limit store and a coordinated job runner;
  the current in-process worker is intended for a single API instance.
- API responses use no-store, nosniff, frame denial, no-referrer, restrictive
  permissions and an API-only content-security policy. The production frontend
  host must separately configure HTTPS, HSTS and an appropriate frontend CSP;
  do not copy the API's `default-src 'none'` policy onto the frontend.
- Production startup requires an explicit HTTPS `APP_ORIGIN` without a trailing
  slash and a PostgreSQL `DATABASE_URL` with non-default credentials. Configure
  Secure cookies by setting `NODE_ENV=production`. Local development credentials
  remain for local use. Keep Postgres on localhost/a private network.
- Existing HttpOnly/SameSite session cookies, salted scrypt passwords, origin
  checks on writes, parameterized SQL, private history, supported-image signature
  checks and 8 MB upload limits remain in place. Unknown request/worker errors
  do not log raw message bodies, provider response bodies or connection secrets.
- Account disabling does not recall requests already sent to providers. No
  email verification, password recovery, MFA, admin reauthentication, automatic
  message retention policy or encrypted application storage has been added.
  Use a strong unique admin password; configure backups/storage encryption and
  operational monitoring before exposing the app publicly. Audit dependencies
  regularly; a clean audit is a point-in-time advisory check.

Security references: [OWASP authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
and [session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

## API

Base path: `/api/v1`. Vite proxies `/api` to the backend on port 3001.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Public liveness check |
| POST | `/auth/register` | JSON email/password; creates account and session |
| POST | `/auth/login` | JSON email/password; creates session |
| GET | `/auth/me` | Current account; 401 when logged out or expired |
| POST | `/auth/logout` | JSON `{}`; revokes session and clears cookie |
| POST | `/scan` | Authenticated; JSON text or multipart image field `file`; returns 202 and scanId |
| GET | `/scan/:id` | Authenticated; owner's scan; 404 for another account's scan |
| DELETE | `/scan/:id` | Authenticated; permanently deletes only the owner's scan; 404 for another account's scan |
| GET | `/scans?limit=50` | Authenticated; owner's history; maximum 100 |
| GET | `/admin/users?limit=20&offset=0` | Admin only; account metadata and scan counts, without SMS content |
| PATCH | `/admin/users/:id` | Admin only; JSON `{ "disabled": true/false }`; revokes sessions and audits the change |

PowerShell example (create your account in the UI first):

```powershell
$credentials = @{ email = 'you@example.com'; password = 'your-long-password' } | ConvertTo-Json
Invoke-RestMethod http://localhost:3001/api/v1/auth/login -Method Post -ContentType 'application/json' -Body $credentials -SessionVariable safeTextSession
$message = @{ text = 'You won a prize! Claim at https://example.com' } | ConvertTo-Json
$scan = Invoke-RestMethod http://localhost:3001/api/v1/scan -Method Post -ContentType 'application/json' -Body $message -WebSession $safeTextSession
Invoke-RestMethod "http://localhost:3001/api/v1/scan/$($scan.scanId)" -WebSession $safeTextSession
```

Status is `RUNNING` during `QUEUED -> EXTRACTING -> ANALYZING`, then `COMPLETE`,
`PARTIAL`, or `INCONCLUSIVE`. Errors use `application/problem+json` with
`type`, `title`, `status`, and `detail`.

A finished scan means:

- `COMPLETE` — Kimi analysis and Safe Browsing both succeeded.
- `PARTIAL` — one stage failed (`incomplete` lists which). The result is still
  usable: a URL flagged by Safe Browsing forces a `MALICIOUS` verdict with
  confidence >= 90 even when analysis failed.
- `INCONCLUSIVE` — text extraction failed, or both providers failed.

## Development commands

```powershell
npm run build
npm run test
npm --prefix server run typecheck
npm --prefix server run start
```

Build compiles both apps and copies the SQL schema into the backend output.
`start` runs the compiled API; serve `web/dist` separately for a production frontend.
Tests require PostgreSQL (`npm run db:up`) and create/drop an isolated schema without
modifying development tables. Set `TEST_DATABASE_URL` to use another test database;
its user must have permission to create schemas.

Provider adapters live in `server/src/providers`, wired in `index.ts`:

| Interface | Implementation |
| --- | --- |
| `OcrProvider` | `LlmWhispererOcrProvider` — binary submission, bounded polling, one-time retrieval |
| `ScamAnalyzer` | `KimiScamAnalyzer` — strict-JSON chat completion, validated locally, one stricter retry on malformed output |
| `UrlThreatIntel` | `GoogleSafeBrowsingThreatIntel` — `MALWARE`, `SOCIAL_ENGINEERING`, `UNWANTED_SOFTWARE` lookups |

Both live providers share timeouts, retries for temporary failures
(timeout, HTTP 429, 5xx), per-provider rate limiting, and a circuit breaker
that fails fast after repeated outages without blocking other scans.

## GitHub Actions and future deployment

`.github/workflows/ci.yml` runs on every push and pull request, and can also be
started manually from the repository's **Actions > CI > Run workflow** menu.
It verifies Node.js 22 and 24 on Linux, installs both apps from their lockfiles,
type-checks and builds them, runs the integration tests against a temporary
PostgreSQL service, and starts the compiled API to verify its health endpoint.
The CI database is created for each job; no local or production data is used.
No repository secrets are required for CI.

Successful Node.js 24 jobs upload two artifacts, retained for 14 days:

- `web-build`: the contents of `web/dist`, ready for a static host with an SPA
  fallback to `index.html` and an `/api` proxy to the backend.
- `server-build`: `dist`, `package.json`, and `package-lock.json`. After downloading
  into a server directory, run `npm ci --omit=dev`, supply the database and origin
  configuration through environment variables, then run `npm start`.

Actions are pinned to commit hashes. Dependabot checks action updates weekly.
After the first successful GitHub run, configure your branch protection/ruleset
to require both **Build and test (Node 22)** and **Build and test (Node 24)**.

For future CD, the CI workflow also supports `workflow_call`. A deployment workflow
can call it using `uses: ./.github/workflows/ci.yml`, then make its deploy job depend
on that verification job with `needs`. Deploy only trusted pushes to your release
branch, use a GitHub Environment for deployment secrets/approvals, and download
the artifacts from that same run. The hosting provider, production database,
credentials, and deployment command must be configured when a destination is chosen.
There is currently no deployment job or production database connection in Actions.

## Troubleshooting

- **`EPERM ... unlink ... esbuild.exe` during setup**: a running dev server is holding
  the Windows executable open. Stop SafeText dev terminals with Ctrl+C, then rerun
  `npm run setup`. An interrupted install can also cause **Cannot find module ... vite.js**;
  complete setup successfully before starting dev again. Setup checks for running
  SafeText processes before installing. Administrator access is not normally needed.

- **`open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified`**:
  the Docker CLI cannot reach Docker Desktop's Linux engine. Open Docker Desktop,
  wait for its engine, and retry `docker info`. If needed, restart Docker Desktop
  and check **Settings > General > Use the WSL 2 based engine**. Check `wsl --status`
  and follow the [Docker Windows setup instructions](https://docs.docker.com/desktop/setup/install/windows-install/)
  if WSL or virtualization needs configuration. Changing the Postgres image does not fix a missing engine pipe.
- **`ash` or `bash` is not recognized**: omit the Markdown code-fence lines when copying commands.
- **PowerShell blocks `npm.ps1`**: use `npm.cmd` in place of `npm` above.
- **Port 5432 already allocated**: stop the conflicting PostgreSQL or change the Compose
  host port and the port in `server/.env`'s `DATABASE_URL`.
- **Database connection/authentication error**: check `docker compose ps` and ensure
  `server/.env` matches the database credentials.
- **UI cannot reach server**: check <http://localhost:3001/api/v1/health> and the backend
  terminal. Open <http://localhost:5173> after starting both apps.
- **403 Invalid origin**: use `localhost:5173` or update `APP_ORIGIN` to match your frontend URL and restart the API.
