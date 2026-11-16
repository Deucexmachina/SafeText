# SafeText deployment setup

Use one **Render Free Web Service** for the React website and Node API, plus
**Neon Free PostgreSQL** for accounts and scan history. This fits the current
in-process OCR and analysis queue and keeps login and API requests at one address.
Use this setup for a class demo or small trial. For dependable campus use, budget
for an always-on service and database capacity, backups, and operational review.

## Hosting compatibility

| Setup | Fit for SafeText |
| --- | --- |
| Render web service plus Neon | Recommended free demo setup; runs the existing Node process and connects using the existing PostgreSQL driver. |
| Vercel frontend plus Render API plus Neon | Possible with a same-origin `/api` proxy and careful cookie/origin configuration. More setup than one Render service. |
| Whole app as ordinary Vercel Functions | Requires backend changes. The queue continues after HTTP 202 and currently assumes a persistent process. Functions also have a 4.5 MB payload limit, below SafeText's 8 MB image limit. |
| Render plus paid Render PostgreSQL | A compatible alternative if you want hosting and the database in one provider. |

Vercel supports backends and external databases, so PostgreSQL and OCR are not
inherently incompatible. The mismatch is this application's current queue and
upload design. Vercel's newer worker/workflow services would need separate
evaluation and integration; this repository does not use them.
[Vercel function limits](https://vercel.com/docs/functions/limitations).

Render Free sleeps after 15 minutes without incoming traffic and takes about a
minute to wake. Its 750 monthly free instance hours are shared across a workspace.
Build, bandwidth, and unusually high outbound traffic limits also apply, including
calls to external databases and APIs. Render Free PostgreSQL expires after 30 days;
use Neon to avoid that particular expiry. [Render free service limits](https://render.com/docs/free).
Neon offers a free plan with usage limits and database compute that sleeps when
inactive. Check the current allowance in your dashboard. [Neon pricing](https://neon.com/pricing).

Hosting does not include LLMWhisperer, Kimi, or Google API usage. Check each
provider's current quota and billing before running public scans. Missing keys
produce partial or inconclusive results, rather than a real demonstration verdict.

## Initial setup on Windows

1. Install Node.js 24 LTS, Git, VS Code, and Docker Desktop. Start Docker Desktop
   and wait until the Linux container engine is ready.
2. Open the existing **SafeText** project folder in VS Code. Choose
   **Terminal > New Terminal**. The terminal should be PowerShell in the folder
   containing the root `package.json`.
3. Run these commands one at a time:

   ```powershell
   npm.cmd run setup
   npm.cmd run db:up
   ```

4. Open `server/.env` in VS Code. Fill in `LLM_WHISPERER_API_KEY`, `KIMI_API_KEY`,
   and `GOOGLE_SAFE_BROWSING_API_KEY` using your own provider accounts. Match
   `LLM_WHISPERER_BASE_URL` to the key's region. Keep the local database URL and
   `APP_ORIGIN=http://localhost:5173` for local development. See the README's
   **Provider API keys** section. Never upload this file to GitHub.
5. Run `npm.cmd run dev`, open <http://localhost:5173>, and create an account.
   Test a pasted message and a screenshot. Keep the terminal open while using it;
   press Ctrl+C to stop.
6. With Docker still running, check the code before publishing changes:

   ```powershell
   npm.cmd test
   npm.cmd run build
   ```

Local Docker data stays on your computer. Deployment creates a separate database;
local accounts and scans do not automatically move to Neon.

## Upload the deployment changes to GitHub

1. In VS Code, select **Source Control** on the left. Review the changed files.
   Include the deployment files, updated server files, root `package.json`,
   workflow, and README. Stage only intended project changes. Do not stage
   `.env`, credentials, or unrelated changes.
2. Your current small-project workflow can push directly to `main`. Commit with
   `feat: bound stored scan history and document deployment`, then choose **Push**
   or **Sync Changes**. Review incoming changes first if VS Code indicates any.
3. On [the GitHub repository](https://github.com/Deucexmachina/SafeText), open
   **Actions > CI** for the latest `main` commit. Wait for
   **Build and test (Node 22)**, **Build and test (Node 24)**, and
   **SafeText required checks** to pass.
4. Continue with Neon and Render below. The optional branch protection section
   can be skipped. Render's **After CI Checks Pass** setting works with direct
   pushes to `main`; branch protection is not required for it.

## Optional protection for main on GitHub

The warning refers to repository settings. A workflow file by itself does not
protect `main`. GitHub Actions runs after GitHub receives a push; the protection
prevents unverified changes from merging into `main`.
[GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).

1. On GitHub open **SafeText > Settings > Branches > Add classic branch protection
   rule**. Enter `main` as the branch pattern. If GitHub shows rulesets first, use
   the classic branch protection option or create an active branch ruleset
   targeting `main` with the equivalent requirements.
2. Enable **Require a pull request before merging**. For a team, enable one
   approving review if another member can review your work.
3. Enable **Require status checks to pass before merging** and **Require branches
   to be up to date before merging**.
4. Search for and require **SafeText required checks**, sourced from GitHub Actions.
   It appears after this workflow has run. This job fails if either Node version's
   build/test job fails or is cancelled/skipped.
5. Enable **Require conversation resolution before merging** and **Do not allow
   bypassing the above settings** if available. Leave **Allow force pushes** and
   **Allow deletions** unchecked. Save the rule.
6. From then on, push work to feature branches and merge pull requests after the
   required checks pass. A rejected direct push to `main` is expected.

Protection is available for public repositories on GitHub Free. Private repository
availability depends on the account plan; GitHub may ask for an upgrade. Check
whether the rule is active rather than assuming it is enforced.

CI installs locked dependencies, checks TypeScript, builds both apps, and runs
provider, pipeline, account, permissions, and database tests with isolated test
data. It also starts the compiled app in production mode and verifies HTML,
page refresh routes, JavaScript assets, authentication, and origin rejection.
Provider tests use mocks, so CI needs no provider keys and does not certify live
provider availability or browser layout.

## Create the Neon database

1. Open [Neon](https://neon.com), sign up, and choose the **Free** plan.
2. Create a project named `safetext`. Choose PostgreSQL 16 if available and a
   region close to your Render service, preferably Singapore if offered.
3. Open **Connect**, select the project database and owner role, and choose a
   **Direct connection**. SafeText uses one backend instance and applies schema
   changes at startup; the direct endpoint also supports its admin command.
4. Copy the PostgreSQL connection string privately. Keep its TLS parameters,
   including `sslmode=require`. Do not disable certificate verification or put
   this string in client code, GitHub, screenshots, or chat.
5. Use this string only as the Render `DATABASE_URL` below. Do not replace your
   local development database URL unless intentionally connecting to the hosted DB.

No manual table creation or cloud Docker installation is needed. SafeText applies
its schema automatically when the Node server starts.
[Neon connection instructions](https://neon.com/docs/connect/connect-from-any-app).

## Create the Render service

Use either the manual steps here or the Blueprint option below, once.

1. Open [Render](https://render.com), sign in with GitHub, and authorize access to
   the SafeText repository.
2. Choose **New > Web Service**, connect `Deucexmachina/SafeText`, and set:

   | Field | Value |
   | --- | --- |
   | Name | An available name such as `safetext-nano` |
   | Branch | `main` |
   | Region | Singapore, or the closest available region to the database |
   | Language / Runtime | Node |
   | Root Directory | Leave blank |
   | Build Command | `npm --prefix server ci --include=dev && npm --prefix web ci --include=dev && npm run build` |
   | Start Command | `npm start` |
   | Instance Type | Free |
   | Health Check Path | `/api/v1/health` |

3. Under **Environment**, add these values. Replace the example hostname with the
   actual Render hostname allocated to your service. All these variables belong
   to the backend service; none need a `VITE_` prefix.

   | Key | Value |
   | --- | --- |
   | `NODE_VERSION` | `24` |
   | `NODE_ENV` | `production` |
   | `SERVE_WEB` | `true` |
   | `APP_ORIGIN` | `https://YOUR-ACTUAL-HOST.onrender.com` with no trailing slash |
   | `DATABASE_URL` | Your private Neon direct connection string, including TLS parameters |
   | `LLM_WHISPERER_API_KEY` | Your OCR key |
   | `LLM_WHISPERER_BASE_URL` | Your regional v2 base URL; US default is `https://llmwhisperer-api.us-central.unstract.com/api/v2` |
   | `KIMI_API_KEY` | Your Moonshot AI key |
   | `KIMI_MODEL` | `kimi-k3`, the current app default, or an API model your account supports |
   | `GOOGLE_SAFE_BROWSING_API_KEY` | Your key for the Safe Browsing v4 API |

   Retention limits already have defaults in code. You can explicitly add these
   variables to Render to make them easy to adjust later:

   | Key | Default |
   | --- | --- |
   | `SCAN_RETENTION_DAYS` | `30` |
   | `MAX_SCANS_PER_USER` | `100` |
   | `MAX_STORED_SCANS` | `1000` |
   | `MAX_PENDING_IMAGE_MB` | `32` |
   | `AUDIT_RETENTION_DAYS` | `90` |
   | `MAX_ACCOUNTS` | `500` |

   Leave `PORT` unset; Render supplies it. The build explicitly installs development
   dependencies because TypeScript and Vite are needed to compile the app.
   If the final hostname is only shown after creation, update `APP_ORIGIN` to that
   hostname and redeploy before testing login.
4. In **Settings > Build & Deploy**, choose **Auto-Deploy > After CI Checks Pass**.
   Choose this during creation if offered; otherwise set it immediately afterward.
   This makes later deployments wait for GitHub checks. Initial creation and manual
   deployment can bypass this automatic trigger, so deploy a verified commit first.
   [Render deployment behavior](https://render.com/docs/deploys).
5. Create the service and watch **Events** and **Logs**. Wait for **Live**. If the
   service fails, check the database URL, TLS parameters, frontend build, and HTTPS
   origin. Share sanitized error text only.

The alternative **New > Blueprint** path reads `render.yaml` from `main` and fills
in the service settings and CI deployment trigger. Supply the prompted private
values. `APP_ORIGIN` must still match the actual allocated service hostname;
update it after creation if necessary. Use the Dashboard Environment editor for
later secret changes. Never enter real keys in `render.yaml`.

Render is hosting the Node process, which calls OCR, Kimi, and Safe Browsing over
HTTPS. Those providers are separate services. The website and API use the same
origin, so no CORS setup or second static-site deployment is necessary.

Keep one app instance. The queue's restart recovery assumes a single process;
avoid deploying during active scans because restarts can interrupt jobs and
recovery can repeat provider work. Multi-instance processing requires additional
job coordination before scaling.

The app currently uses the direct connection IP for authentication throttling.
Behind a hosting proxy, visitors can share the 20-attempt login/registration
bucket for 15 minutes. Validate the host's proxy chain and configure trusted
proxies before wider campus use; do not enable unrestricted `trust proxy`.

## Verify the deployed website

1. Open `https://YOUR-ACTUAL-HOST.onrender.com/api/v1/health`. Expect
   `{"status":"ok"}`. This confirms the process is responding, not provider health.
2. Open the website root and create a new hosted account. Confirm login, logout,
   and login again work. Use a password of 12 to 128 characters.
3. Submit a harmless pasted message and confirm the scan finishes and appears in
   History. Check `incomplete` stages if it is partial or inconclusive.
4. Upload a readable screenshot containing synthetic SMS text. Confirm extraction
   matches the image and the verdict contains reasons. Do not assume a successful
   pasted-text scan proves OCR is configured.
5. Refresh `/history` directly. The website should still load. Create another test
   account and verify it cannot view the first account's history.
6. Open the service shortly before a class demo and allow time for a cold start.
   Free hosting does not guarantee the proposal's 60-second scan target.

For later updates: commit and push to `main`, then check **GitHub > Actions**.
Render deploys the commit automatically when its checks pass. No Render API key or deploy hook needs
to be placed in GitHub Actions for this setup.

## Automatic storage management

Finished scans expire after 30 days. New submissions can remove the oldest
finished scans sooner to stay within 100 scans per user and 1,000 overall.
Active work is preserved; when capacity cannot be freed, the app returns a clear
429 error. Deleted scan history is permanent, including old history that existed
before this update. Users see the policy on History.

Screenshot data has a 32 MiB aggregate database budget while waiting for OCR.
It is removed after extraction/failure. Abandoned jobs older than 24 hours are
marked inconclusive and release their screenshots. Extraction and provider result
sizes are bounded. Browser polling and History never retrieve image bytes from Neon.
This budget does not cap all runtime memory or provider charges.

Expired sessions and login-throttle records older than a day are removed;
audit events expire after 90 days. Login retains up to five sessions per account.
Registration stops at 500 accounts; retention never deletes accounts automatically.

Cleanup runs at startup and on normal API traffic, at most once per hour.
No cron service or idle database wakeup is needed; when Render sleeps, cleanup
waits for the next startup/request. Existing cleanup-eligible data is removed on
the first run. Reducing limits can remove more history after redeployment.

In Neon, review **Storage** and **Compute** usage periodically; in Render review
**Usage/Billing**. Stay on the Free plans and avoid creating unused database
branches/projects. Deleted rows free reusable database space through autovacuum;
physical size and restore history may not drop immediately. Do not disable TLS
or run `VACUUM FULL` as a routine fix. These application limits leave headroom
but do not guarantee that hosting quotas or API budgets can never be exceeded.

## Configure password reset email

The Render website address stays `https://safetext-nano.onrender.com`. Email is
sent by a separate provider. Render Free blocks standard SMTP ports, so use the
new Brevo HTTPS adapter instead of Gmail SMTP. A verified sender mailbox can be
used for the class demo without purchasing a website domain.
[Render SMTP restrictions](https://render.com/docs/free).

1. First commit and push the password-reset changes to `main`. Wait for GitHub CI
   and the Render deployment to succeed.
2. Create a [Brevo](https://www.brevo.com) account, choose its free option if
   available for your account, verify your login email, and complete the requested
   account/transactional-email activation steps.
3. In Brevo open **Settings > Senders, Domains, IPs > Senders > Add a sender**.
   Use **SafeText** as the sender name and a mailbox your group controls as the
   sender email. Confirm the verification code sent to that mailbox. For a Gmail
   sender, authentication warnings are expected; a domain you control can be
   authenticated later to improve deliverability. Do not attempt to authenticate
   Render's `onrender.com` domain.
   [Brevo sender verification](https://help.brevo.com/hc/en-us/articles/208836149-Create-a-new-sender-From-name-and-From-email).
4. In Brevo's **Settings > SMTP & API > API Keys & MCP** section, generate a key
   named `SafeText Render`. Choose an ordinary API key with access to send
   transactional emails, not an SMTP or MCP key. Keep it private.
   [Brevo API key instructions](https://help.brevo.com/hc/en-us/articles/209467485-Create-and-manage-your-API-keys).
5. In [Render](https://dashboard.render.com), open **safetext-nano > Environment**.
   Add or update:

   | Key | Value |
   | --- | --- |
   | `BREVO_API_KEY` | The private Brevo API key |
   | `EMAIL_FROM` | `SafeText <YOUR-VERIFIED-EMAIL>` using the exact verified sender address |
   | `NODE_ENV` | `production` |
   | `APP_ORIGIN` | `https://safetext-nano.onrender.com` without a trailing slash |

   Enter values directly without wrapping quotes. Remove `EMAIL_DEV_LOG` and any
   unused `SMTP_URL`. The new HTTPS key takes precedence over old SMTP settings.
   Leave `DATABASE_URL` and the scan-provider keys unchanged. No Neon changes,
   Gmail app password, new website domain, or additional server are needed.
6. Click **Save, rebuild, and deploy** or the equivalent save-and-deploy option.
   If saving does not deploy automatically, use **Manual Deploy > Deploy latest
   commit**. Wait for **Live**.
7. Open the deployed website in a logged-out browser, or go directly to
   <https://safetext-nano.onrender.com/forgot-password>. Use an email already
   registered on the deployed website. The sender mailbox and reset recipient
   are separate: the code goes to the registered account asking to reset.
8. Check the recipient inbox and spam folder, verify the newest six-digit code
   within five minutes, and choose a new password of 12 to 128 characters. Confirm
   the new password works, the old one fails, and previous sessions are signed out.

Codes are single-use. Wait 60 seconds before resending; the newest code replaces
older codes. After eight wrong guesses, request another code. Successful resets
are capped at three per rolling day. An expired code at the password step can
be replaced using **Request a new code**.

If the page says **Password reset unavailable**, check that both email variables
are configured and `EMAIL_FROM` is a real address rather than the `.local` default.
If no email arrives after an apparently successful request, inspect **Brevo >
Transactional > Logs** and **Render > Logs**. Check the API key, verified sender,
account activation, sending quota, bounced/blocked recipients, and spam folder.
Sanitized Render warnings may include 401 (key), 403 (permissions/account/sender),
429 (quota/rate limit), or a provider server error. A generic success response
protects account privacy and does not prove that a mailbox received the email.
Never share the API key, reset code, or a screenshot showing secret values.

## Give the chosen account admin access

The hosted database begins without an admin. Register `safetextadmin@gmail.com`
on the deployed website using a password you choose. Render Free has no Dashboard
shell; run the existing promotion command from your own VS Code terminal instead.

Stop local development servers first. In a fresh PowerShell terminal:

```powershell
$env:DATABASE_URL = Read-Host 'Paste the private Neon direct connection string' -MaskInput
try {
  npm.cmd --prefix server run admin:grant -- safetextadmin@gmail.com
} finally {
  Remove-Item Env:DATABASE_URL
}
```

`-MaskInput` requires PowerShell 7. If the VS Code terminal uses Windows PowerShell
5.1, open a PowerShell 7 terminal first. The typed connection string is masked and
is not part of command history. The command targets the hosted database because
the environment variable overrides `server/.env`. Sign in again after promotion;
promotion revokes existing sessions. Promote only the registered account you
intend to administer. Keep the database owner connection string private.

## Use a Render subdomain or custom domain

The free `https://your-name.onrender.com` address is suitable for a project demo.
The name depends on availability, and Render handles HTTPS. A paid domain is
optional. Render supplies hosting and a subdomain; a custom name such as
`safetext.example` needs to come from a domain registrar or your campus IT office.
[Render custom domains and TLS](https://render.com/docs/custom-domains).

To use a custom domain later:

1. Obtain the domain, or ask campus IT to allocate a campus subdomain.
2. In Render, open **Service > Settings > Custom Domains > Add Custom Domain**.
3. At your domain/DNS provider, add exactly the DNS records Render displays.
4. Return to Render, verify the domain, and wait for HTTPS to become ready.
5. Set `APP_ORIGIN` to that exact HTTPS origin, without a trailing slash, and
   redeploy. Use this address consistently for login; the app accepts one browser
   origin for writes, so the old Render address is no longer the login address.
