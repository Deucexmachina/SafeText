# SafeText

Check an SMS for signs of a scam. Register or log in, paste a message or upload
a screenshot, and review the verdict and your private scan history.

The app uses React/TypeScript (Vite), Node.js/TypeScript (Express), and PostgreSQL 16.
Accounts, sessions, and scans persist in PostgreSQL. The in-process scan queue
resumes unfinished jobs when the backend restarts.

**OCR, scam analysis, and URL threat intelligence still use stub providers.**
Screenshot OCR returns canned text. Results are for development, not reliable scam detection.

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
- Image deduplication is per account. Uploading identical bytes in another account
  creates a separate scan. Other accounts cannot access your scans by their IDs.

Passwords use salted scrypt hashes. Sessions last seven days, using random tokens
in HttpOnly, SameSite cookies; the database stores only token hashes. Logout revokes
the session. Login and registration share a limit of 20 attempts per IP per 15 minutes;
the limit resets when the API restarts.

Browser writes must match `APP_ORIGIN` (default `http://localhost:5173`). Use that exact
URL locally. Vite stays on port 5173 so it cannot silently change origins.
For deployment, use HTTPS, set `NODE_ENV=production` to enable Secure cookies,
set `APP_ORIGIN` to the public origin, and serve the frontend and `/api` from that
same origin. Email verification, password resets, and multi-factor authentication
are not implemented.

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
| GET | `/scans?limit=50` | Authenticated; owner's history; maximum 100 |

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

| Interface | Current behavior | Planned integration |
| --- | --- | --- |
| `OcrProvider` | Canned SMS text | LLM Whisperer |
| `ScamAnalyzer` | Heuristic scoring | Kimi |
| `UrlThreatIntel` | Risky domains and shorteners | Google Safe Browsing |

Provider API keys in `server/.env.example` remain unused until real integrations are added.

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
