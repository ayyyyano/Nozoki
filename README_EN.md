# Nozoki

<img align='right' src='public/logo.png' width='200px' alt="Nozoki logo">

[DEMO}(https://nozoki.nekro.top/) | [简体中文](README.md)

Nozoki is a personal dashboard for Cloudflare Workers or a Node.js server. Nuxt 4 runs the pages and server APIs. Cloudflare deployments use D1; server deployments store settings, sessions and snapshots in a local SQLite file.

## Dashboard modules

| Module    | Content                                                                                                   |
| --------- | --------------------------------------------------------------------------------------------------------- |
| DeepSeek  | Current balance and a seven-day remaining-balance bar chart, with optional guest masking                  |
| Devices   | Sleepy status text, identifiable foreground applications, optional battery and external power information |
| Tailscale | Device names, control-plane connection status and IP visibility based on login                            |
| Codex     | CLIProxyAPI account status, scheduled quota reads and daily UTC queue usage                               |
| Activity  | Weekly schedules, multiple periods, templates, date exceptions, countdowns and progress                   |
| Quotes    | Tencent prices, daily changes, volume and five-day history                                                |
| Links     | Bookmarks, ordering and Material icons                                                                    |
| Services  | Uptime Kuma and UptimeFlare monitor status and latency                                                    |

The admin interface controls module availability, ordering, titles and access permissions. The server filters data for the current session. Visitor requests read saved results from the database.

The admin page manages source addresses, protocols, credentials and access approvals. Cloudflare Workers fetch approved public HTTPS sources directly. Node.js uses an embedded connector. QQQM and VOO use the enabled Tencent source by default. Codex displays account status, confirmed passive quota observations and daily UTC queue usage received after statistics are enabled.

DeepSeek needs only a balance source. Today's bar updates with collection; historical bars use the last successful sample of each day in the site timezone. Missing days stay empty. The existing scheduler brings collection forward before day end, but outages or upstream failures can prevent a closing sample. Enable guest masking under Dashboard modules → DeepSeek to return placeholder data to guests; authenticated viewers remain subject to field permissions.

## Tech stack

| Technology                           | Version |
| ------------------------------------ | ------- |
| Vue                                  | 3.5.44  |
| Nuxt                                 | 4.6.2   |
| Varlet UI                            | 3.20.7  |
| xicons Material (`@vicons/material`) | 0.13.0  |
| TypeScript                           | 5.9.3   |
| Node.js                              | 24.21.0 |

## Local development

```sh
pnpm install --frozen-lockfile
pnpm db:init
pnpm dev
```

Open http://127.0.0.1:3000. Both `db:init` and `db:migrate` apply local SQL migrations. The regular local database lives in `.wrangler/state/v3`. The API returns a service-unavailable response if the database binding or initial configuration is missing.

For a generated local admin account, run:

```sh
pnpm dev:local
```

Login details are stored in `.wrangler/local-debug/LOGIN.txt`. The first run copies the regular local database. Debug changes go to `.wrangler/local-debug/state/v3`, and later runs reuse this database and account. Stop any service using port 3000 before starting a development command.

`pnpm dev` uses the existing environment configuration. To set your own local account, copy [.dev.vars.example](.dev.vars.example) to `.dev.vars` and fill in the values. Edit an existing `.dev.vars` file directly.

## Administrator configuration

| Variable                 | Purpose                                                                  |
| ------------------------ | ------------------------------------------------------------------------ |
| `ADMIN_EMAIL`            | Administrator email address                                              |
| `ADMIN_PASSWORD`         | Administrator password, 12 to 1024 characters                            |
| `AUTH_VERSION`           | Positive session version; increment it when changing account credentials |
| `AUTH_ORIGIN`            | Full site origin, such as `https://dashboard.example.com`                |
| `AUTH_RATE_LIMIT_SECRET` | Independent random 32-byte base64url secret                              |
| `AUTH_ALLOW_LOCAL_HTTP`  | Set to `1` for local loopback HTTP development                           |

Cloudflare uses `.dev.vars` locally and Worker Secrets for production passwords and auxiliary secrets. Node.js reads a protected environment file. `AUTH_ORIGIN` must match the browser address. Development and local Workers preview use ports 3000 and 8787 respectively. Missing required authentication settings disable administrator login; public dashboard requests continue as guests.

Successful login opens `/admin`. A separate login page is available at `/login`. Configuration saves check CSRF tokens, the shared configuration version and request idempotency. Sessions default to a 12-hour absolute lifetime and a 30-minute idle timeout. Logout revokes the session in the database.

Integration credentials use `keep`, `replace` and `clear` operations. Replacement requires `INTEGRATION_ENCRYPTION_KEY` and `INTEGRATION_KEY_VERSION`. Existing encrypted credentials need the matching key version. `INTEGRATION_DECRYPTION_KEYS` supplies retained versions. Keep those keys available when rotating credentials.

## Build and preview

```sh
pnpm build
pnpm preview
```

Open http://127.0.0.1:8787. The Dashboard Worker entry is `.output/server/index.mjs`; static files are in `.output/public`.

Pages, APIs and scheduled collection use one Worker. Its Cron calls the independent collection engine every five minutes; each source keeps its own refresh interval. In local preview, open `http://127.0.0.1:8787/cdn-cgi/handler/scheduled` to trigger it manually. Wrangler provides this local route; production has no public collection endpoint.

Collection uses database leases and source revision checks. A failed attempt keeps the last valid snapshot and records the error separately.

## Quick deployment with an agent tool

Send the whole prompt below to an AI agent that can run commands in the project directory, such as Codex CLI or Claude Code. The agent completes the first deployment with wrangler and then binds the Worker to your GitHub repository, so later pushes build and deploy automatically. Automatic deployment defaults to Cloudflare Workers Builds, or the repository's own GitHub Actions workflow via steps 9.a–9.c at step 9. `wrangler login` requires one browser authorization; the Git binding needs one connect confirmation in the Cloudflare dashboard (including the GitHub App authorization). All other steps run in the terminal. Skip to the next section if you prefer doing each step by hand.

```text
Deploy the Nozoki dashboard in the current directory to Cloudflare Workers and bind the Worker to my GitHub repository by default, so future pushes build automatically. Use the command line only apart from the final Git binding step, which I confirm in the dashboard; do not open the Cloudflare dashboard for anything else. Ask me before creating any cloud resource. Before starting, read the "Administrator configuration" and "Deploy to Cloudflare from GitHub" sections of README_EN.md. This flow commits and pushes the deployment configuration to my repository.

Preparation:
1. Check for Node.js 24 and Git. Install pnpm with npm install --global pnpm@12.15.0 if it is missing, then run pnpm install --frozen-lockfile.
2. Ask me for the administrator email, then run pnpm exec wrangler login and finish the browser authorization.

Cloud resources:
3. Run pnpm exec wrangler d1 create nozoki-db. Put the returned database_id into the root wrangler.jsonc and set ADMIN_EMAIL in vars to that email. The file currently holds local placeholder values; replace it with the template from step 2 of the next section if that is easier.
4. Run pnpm exec wrangler d1 migrations apply DB --remote --config wrangler.jsonc to create the cloud tables.

Build and deploy:
5. Run pnpm build and then pnpm deploy:cloudflare. Record the workers.dev address from the output.
6. Add that address as AUTH_ORIGIN in the vars of wrangler.jsonc and run the deploy command again.
7. Run node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))" to generate one secret and set it as AUTH_RATE_LIMIT_SECRET with pnpm exec wrangler secret put. Ask me for the administrator password. Supply both values through interactive input or stdin; never write them to files, command-line arguments or your reply.
8. Verify the deployment: request the address from step 5 and confirm the dashboard responds, sign in at /admin with the administrator email and password, change the site name, save and refresh to confirm the change persists. Report the result and anything unfinished.

Git binding for automatic builds:
9. Run git remote -v to confirm the repository; ask me for its URL if no remote exists. Commit and push deployment settings to the production branch (master by default). Guide me through nozoki-dashboard → Settings → Builds → Connect. Select that repository and branch, keep the repository root, use pnpm build as the build command and pnpm deploy:cloudflare as the deploy command. Connect this one Worker; later pushes update pages and scheduled collection together.

GitHub Actions binding for automatic deployment (when I choose Actions instead of Cloudflare Builds):
9.a. Use the repository's included workflow `.github/workflows/deploy-cloudflare.yml` instead: guide me to open **Actions** in my fork and enable workflows when prompted (sync the version containing the workflow first for an existing fork). The runner uses the pinned Wrangler version, so the pushing device needs no Wrangler or wrangler login.
9.b. Create a Cloudflare API token scoped to that account with **Workers Scripts Edit** and **D1 Edit** at the account level (add zone permissions if `wrangler.jsonc` manages routes). Guide me to create the `production` environment under my fork's **Settings → Environments**, add the environment secret `CLOUDFLARE_API_TOKEN`, restrict that environment's deployment branches to the default branch, and add the repository variable `CLOUDFLARE_ACCOUNT_ID` (my Cloudflare account ID) under **Settings → Secrets and variables → Actions → Variables**. These steps happen on GitHub pages that I operate myself; I enter the token value directly.
9.c. Commit and push `wrangler.jsonc` to the fork's default branch to trigger the deployment. The workflow installs dependencies, builds the Worker, applies pending D1 migrations, and publishes it. If the same Worker already uses Cloudflare Workers Builds, disable its Git deployment there to avoid duplicate releases. Verify by checking a green run under **Actions → Deploy to Cloudflare Workers**, then request the site to confirm the new version is live.

Credential encryption (only when I ask for it):
10. Generate an independent random 32-byte base64url key and set it on the main Worker with pnpm exec wrangler secret put INTEGRATION_ENCRYPTION_KEY. Keep INTEGRATION_KEY_VERSION=v1 in the configuration. Pass the key through interactive input or stdin and ask me to retain it in a password manager. Admin saves and scheduled collection use this single key. Reuse the original key when encrypted credentials already exist.

Scheduled collection:
11. The main Worker Cron enables scheduled collection; no second Worker is needed. Check its */5 * * * * trigger, configure a source and module binding in the admin page, then wait for the next scheduled run.

Security: passwords and secrets belong only in Worker Secrets and Git-ignored local files. Never commit them, and never echo them into logs or your reply.
```

## Deploy to Cloudflare from GitHub

### Automatic deployment with GitHub Actions

Forks can use the included [deployment workflow](.github/workflows/deploy-cloudflare.yml). Push to the fork's own default branch, whether it is `master`, `main`, or another name. The GitHub runner uses the pinned Wrangler version, so your device does not need Wrangler or `wrangler login`.

1. Open **Actions** in your fork and enable workflows when prompted. If you already have a fork, sync the version containing the workflow first.
2. [Create D1](#2-create-the-cloud-database) in your Cloudflare account or use your existing Nozoki database. In your fork's `wrangler.jsonc`, set the database name and ID, target Worker name, and your own `ADMIN_EMAIL`. To use the default address, confirm that your account has a `workers.dev` subdomain under **Workers & Pages**, then set `AUTH_ORIGIN` to `https://<worker-name>.<account-subdomain>.workers.dev`. If you use a custom domain, enter your site's HTTPS origin.
3. Create a Cloudflare API token scoped to that account with **Workers Scripts Edit** and **D1 Edit** at the account level. If `wrangler.jsonc` also manages routes, add the permissions required for the relevant zone.
4. In your fork, create the `production` environment under **Settings → Environments** and add the environment secret `CLOUDFLARE_API_TOKEN`. Restrict that environment's deployment branches to your default branch. Under **Settings → Secrets and variables → Actions → Variables**, add the repository variable `CLOUDFLARE_ACCOUNT_ID` with your Cloudflare **account ID**. Set these values in each fork. The deployment job skips repositories without the account ID.
5. If the same Worker already uses Cloudflare Workers Builds, disable automatic Git deployments there to avoid duplicate releases. Commit `wrangler.jsonc` and push to the fork's default branch. GitHub Actions installs dependencies, builds the Worker, applies pending D1 migrations, and publishes the Worker. If the configuration is already pushed, go to **Actions → Deploy to Cloudflare Workers → Run workflow** and select the default branch.
6. After the first successful release, open your Worker in Cloudflare and [set the runtime secrets](#5-set-the-login-address-and-secrets) `ADMIN_PASSWORD` and `AUTH_RATE_LIMIT_SECRET`. To save data source credentials, also [set `INTEGRATION_ENCRYPTION_KEY`](#6-set-source-credentials-and-scheduled-collection). When switching an existing site, keep its runtime secrets and encryption key.

See the [Cloudflare GitHub Actions guide](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/) and [GitHub's guide to workflows in forks](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflows-in-forked-repositories).

### Deploy with Cloudflare Workers Builds

Steps 1 through 5 give you a working website with administrator login, saved settings and scheduled default quotes. Step 6 adds encrypted source credentials and can be configured later. You need GitHub and Cloudflare accounts. Cloudflare provides a `workers.dev` address, so you can start without your own domain.

Run commands in your computer's terminal, such as PowerShell or the VS Code terminal. After downloading the repository, run the remaining commands in the project root, the folder containing `package.json` and `wrangler.jsonc`.

### 1. Prepare your repository and local tools

Fork this project to your GitHub account, or upload your existing source to your own repository. Install [Node.js 24.21.0](https://nodejs.org/download/release/v24.21.0/) and [Git](https://git-scm.com/downloads), reopen your terminal, then install pnpm:

```sh
npm install --global pnpm@12.15.0
```

In your repository, choose **Code → HTTPS** and copy its address. Replace `YOUR_NAME/nozoki` below with your repository path:

```sh
git clone https://github.com/YOUR_NAME/nozoki.git nozoki
cd nozoki
pnpm install --frozen-lockfile
```

If you already have the project open locally, run the final install command in its root folder.

### 2. Create the cloud database

Open the [Cloudflare dashboard](https://dash.cloudflare.com/), select your deployment account, then create a database named `nozoki-db` under **Storage & databases → D1 SQL Database**. Open its details and copy the **Database ID**, a value shaped like `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`.

For a first deployment, replace the root [wrangler.jsonc](wrangler.jsonc) with this configuration. Fill in your Database ID and administrator email:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "nozoki-dashboard",
  "main": ".output/server/index.mjs",
  "compatibility_date": "2026-10-19",
  "compatibility_flags": ["nodejs_compat", "global_fetch_strictly_public"],
  "workers_dev": true,
  "version_metadata": { "binding": "CF_VERSION_METADATA" },
  "triggers": { "crons": ["*/5 * * * *"] },
  "assets": {
    "directory": ".output/public",
    "binding": "ASSETS",
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "nozoki-db",
      "database_id": "REPLACE_WITH_YOUR_DATABASE_ID",
      "migrations_dir": "migrations",
    },
  ],
  "vars": {
    "ADMIN_EMAIL": "REPLACE_WITH_YOUR_LOGIN_EMAIL",
    "AUTH_VERSION": "1",
    "AUTH_ALLOW_LOCAL_HTTP": "0",
    "INTEGRATION_KEY_VERSION": "v1",
  },
}
```

The email is your login name; Nozoki does not send mail. The Database ID in the repository is a local placeholder for local development. Replace it for cloud deployment. If you already have custom domains or other deployment settings, merge these fields into your configuration.

### 3. Initialize the database and push your settings

Run locally:

```sh
pnpm exec wrangler login
pnpm exec wrangler d1 migrations apply DB --remote --config wrangler.jsonc
```

The first command opens a browser. Authorize the Cloudflare account that owns your database. The second creates the required tables in that cloud database. Check that the target is `nozoki-db`, then enter `y` if prompted. Once migrations finish, commit and push your configuration:

```sh
git add wrangler.jsonc
git commit -m "Configure Cloudflare deployment"
git push origin master
```

Use your actual branch name if it differs from `master`. GitHub Desktop can also commit and push these changes. Database contents stay in Cloudflare and are not uploaded to GitHub.

### 4. Import the repository into Workers

In Cloudflare, open **Workers & Pages → Create application → GitHub**. Authorize access to your repository and select it. Use the Workers repository deployment flow with these settings:

| Setting           | Value                                                   |
| ----------------- | ------------------------------------------------------- |
| Worker name       | `nozoki-dashboard`, matching `name` in `wrangler.jsonc` |
| Production branch | `master`, or your actual branch                         |
| Root directory    | Repository root; keep the default                       |
| Build command     | `pnpm build`                                            |
| Deploy command    | `pnpm deploy:cloudflare`                                |

The repository pins Node.js and pnpm through `.node-version` and `package.json`. If the dashboard requires explicit versions, set build variables `NODE_VERSION=24.21.0` and `PNPM_VERSION=12.15.0`. Use `pnpm build` for Cloudflare; `build:node` is for server self-hosting.

Select **Save and Deploy**, wait for a successful build, then open the supplied `https://nozoki-dashboard.your-subdomain.workers.dev` address. The dashboard should load. The next step enables administrator login.

Use `pnpm deploy:cloudflare`. It applies pending D1 migrations before publishing the Worker with both page and collection handlers. Migration failures stop publication. The Cloudflare Builds deployment token needs **D1 Edit** permission for the database. `pnpm build` only builds and does not access the remote database.

When newer code encounters an intact seven-module database from before migration 0016, the first configuration read switches to read-only compatibility: existing configuration and valid snapshots remain available, while configuration saves, source probes and collection stop. Apply `pnpm exec wrangler d1 migrations apply DB --remote --config wrangler.jsonc` and refresh to recover without restarting the Worker. Empty or damaged databases are not replaced with defaults. Migrations run during deployment, never from visitor requests.

### 5. Set the login address and secrets

Copy the site's full HTTPS address and add `AUTH_ORIGIN` to the root configuration's `vars`, keeping your own administrator email:

```jsonc
"vars": {
  "ADMIN_EMAIL": "you@example.com",
  "AUTH_VERSION": "1",
  "AUTH_ALLOW_LOCAL_HTTP": "0",
  "AUTH_ORIGIN": "https://nozoki-dashboard.your-subdomain.workers.dev",
  "INTEGRATION_KEY_VERSION": "v1"
}
```

Use the origin only, with no trailing slash or `/admin` path. Commit and push this change to trigger another deployment.

Generate a login security secret in your local terminal:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

In Cloudflare, open **Workers & Pages → nozoki-dashboard → Settings → Variables and Secrets**. Select **Add**, choose type **Secret**, and add both entries:

| Name                     | Value                                               |
| ------------------------ | --------------------------------------------------- |
| `ADMIN_PASSWORD`         | Your administrator password, at least 12 characters |
| `AUTH_RATE_LIMIT_SECRET` | The complete output from the command above          |

Select **Deploy** to apply the secrets. These are Worker runtime settings. **Build variables and secrets** on the build page are available only during builds. Keep passwords and secret values in Secret settings, outside `wrangler.jsonc` and GitHub.

Open the website and click the account icon at the top right. Sign in with `ADMIN_EMAIL` and your password. Change the site name in the admin interface, save, then refresh to confirm it persists. Modules without configured sources will show an unconfigured state.

### 6. Set source credentials and scheduled collection

The default Tencent quotes need no API key. To save credentials for other sources, generate an independent encryption key with the random-secret command from step 5. Add runtime Secret `INTEGRATION_ENCRYPTION_KEY` under **nozoki-dashboard → Settings → Variables and Secrets**, then select **Deploy**. The root configuration sets `INTEGRATION_KEY_VERSION=v1`. Keep the key in a password manager; losing it prevents decryption of saved credentials.

Admin saves, read-only probes and scheduled collection share this Worker's D1 binding and Secrets. The configured `*/5 * * * *` Cron runs every five minutes. Disabled sources and sources without enabled module references are skipped. View collection execution in this Worker's logs.

The collection environment follows the [Cloudflare deployment version](https://developers.cloudflare.com/workers/runtime-apis/bindings/version-metadata/) automatically. Adding the encryption key or deploying code requires no manual `COLLECTOR_EPOCH`. For an existing two-Worker installation, disable or delete the old `nozoki-collector` Cron and Git build so it stops running. To roll back code, rebuild and publish the target revision; collection rejects deployments older than the recorded version.

### Adding custom sources in the admin page

1. Open Data sources, click Add source and choose DeepSeek, Sleepy, CLIProxyAPI or another supported type. The app fills in the protocol and authentication scheme and generates an instance ID.
2. Enter the instance HTTPS address or credentials shown for that type. A Sleepy address might be `https://alive.example.com/`. DeepSeek needs an API Key; CLIProxyAPI needs a Management Key. New installations already include Tencent quotes, which needs no credentials.
3. Confirm access to a custom instance, then run Test connection without saving or enabling it. Newly entered credentials are used only for this probe. Saved secrets can be reused only while the source type, protocol, address and authentication scheme remain unchanged.
4. After a successful test, enable the source, bind it to the corresponding Dashboard module's `main` reference, and select Save configuration. The Collector reads it at the configured interval. Tests do not save configuration, credentials or production snapshots. Editing the tested fields invalidates the previous result.

An instance's type and protocol are fixed after creation. Changing its address requires approval again and replacement or deletion of credentials bound to the old address. Saved secrets appear as placeholders. Edit opens an empty field for a new value; Delete asks for confirmation and schedules removal for the next save. You can undo deletion before saving. Credentials are encrypted in the database; admin reads return their configuration status. Each configuration supports up to 10 sources.

Sleepy, Kuma and Flare use their registered read-only protocols. CLIProxyAPI uses `cliproxy-bridge` / `cliproxy-v8-accounts`, with its Management Key as the Bearer credential. A stable account identity key is generated and stored encrypted. Allow `GET /v8/management/credentials` and `GET /v8/management/observability/usage/queue?count=50` on your reverse proxy. Reading the queue consumes its records and happens during collection. Scheduled quota reads on Workers also need `POST /v8/management/requests/api-call`. This management route can make arbitrary upstream requests, so restrict it at the reverse proxy to Nozoki's fixed method and destination, `GET https://chatgpt.com/backend-api/wham/usage`.

### UptimeFlare monitor names

The UptimeFlare status page displays monitor names from `uptime.config.ts`. Nozoki reads each monitor's `name` from `/api/data`. When the default UptimeFlare response omits that field, the Services card and admin monitor list display monitor IDs. [UptimeFlare configuration](https://github.com/lyc8503/UptimeFlare/wiki/Configuration#workerconfig) · [API source](https://github.com/lyc8503/UptimeFlare/blob/main/pages/api/data.ts)

To display names in Nozoki, add `name: monitor.name` to `monitors[monitor.id]` in your UptimeFlare instance's `pages/api/data.ts`, keep the existing monitor IDs, and redeploy UptimeFlare. Once `/api/data` returns the names, wait for Nozoki's next successful collection and refresh the monitor list in the admin Services settings. Existing homepage selections are preserved by ID.

### Public HTTPS access on Cloudflare

The Worker uses `fetch` to read approved sources. Custom public services such as `https://alive.example.com/` need no additional server, connector secret or per-source Worker variable.

The root configuration includes `global_fetch_strictly_public`. Keep this flag so requests to domains in the same Cloudflare zone use their public entry points and respect the destination's Worker routes and security rules. If the service requires Cloudflare Access, a login page or an interactive challenge, configure suitable access rules for its read-only API. The Collector cannot complete browser challenges.

Requests use HTTPS 443 and the approved service directory. Collection uses registered GET endpoints; Tailscale token exchange uses a fixed official POST endpoint. They omit browser cookies and send Bearer credentials only to the approved source. Redirects are rejected. Responses are capped at 128KB; timeouts are 3.5 seconds for ordinary sources and 10 seconds for quotes. Workers' network layer filters private DNS destinations when connecting. The application also rejects IP literals, loopback names and local domain suffixes. See [workerd network rules](https://github.com/cloudflare/workerd/blob/main/src/workerd/server/workerd.capnp) and the [Cloudflare public routing flag](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#global-fetch-strictly-public).

The deployment script applies database migrations before publication. Routine public source additions, approvals and credential changes take effect when saved in the admin page.

Admin sources use public HTTPS. Private IPs, LAN-only names and Tailscale network addresses need a trusted public HTTPS service that exposes a supported read-only API. Node.js resolves and pins a public IP for each connection and verifies the TLS certificate.

### Migrating existing sources

The deployment command applies `0019_public_sources.sql`. Legacy DeepSeek, Tencent, both Yahoo mirrors and Tailscale sources receive equivalent admin approval only when their provider, protocol and official root match exactly. Source IDs, encrypted credentials, module references, quote bindings and history remain stored. The configuration version increases; reload admin drafts opened before the upgrade.

Other legacy sources pause collection and retain their settings for review. Check their public instance addresses under Data sources, supply credentials, confirm access and save. An unrecognized old protocol has a read-only editor; create a supported source to replace it. `NOZOKI_PUBLIC_ROUTES`, `NOZOKI_PRIVATE_ROUTES` and relay routes no longer authorize production collection. Remove those variables and relay settings after migration.

Add a CLIProxyAPI source and enter its Management Key. A key previously held only by a relay must be entered in the admin page. If account-specific field permissions exist, open the account permission migration section and import the original `NOZOKI_RELAY_ID_KEY` in the original account identity key field. Saving reads accounts and checks their IDs. A mismatched key, unreachable target or deleted account blocks the save; check the key and account policies. The identity key is encrypted, and admin reads return its configured status. New sources can leave it blank to generate a key automatically.

### Prerequisites for the Codex usage display (CLIProxyAPI side)

Since v6.10.0 CLIProxyAPI no longer ships built-in usage statistics. The only per-request usage source is the in-memory queue `GET /v8/management/observability/usage/queue?count=N`, which pops records as they are read. Before usage can appear, enable statistics and widen the queue retention window in the CLIProxyAPI `config.yaml` `observability.usage` section, then restart the service:

```yaml
observability:
  usage:
    usage-statistics-enabled: true
    redis-usage-queue-retention-seconds: 3600
```

Both keys are required: `usage-statistics-enabled` turns on enqueueing; `redis-usage-queue-retention-seconds` keeps each record queued for that many seconds (default 60, maximum 3600). The dashboard waits for its next scheduled run before popping the queue (roughly every 10 minutes at default settings), so with the 60-second default records are pruned before they can ever be read — calls still pass through the proxy and execution counters grow, yet usage stays empty. The retention window must exceed the collection interval; 3600 is recommended.

To change it, add the line inside the `usage:` section with the same 4-space indent as `usage-statistics-enabled` (`observability:` at column 0 → `usage:` indented 2 → keys indented 4), using any editor (e.g. `sudo nano /opt/cli-proxy-api/config.yaml`), or apply it with one command and restart:

```bash
sudo sed -i 's/^    usage-statistics-enabled: true$/    usage-statistics-enabled: true\n    redis-usage-queue-retention-seconds: 3600/' /opt/cli-proxy-api/config.yaml && sudo systemctl restart cliproxyapi.service
```

Adjust the path and service name to the actual installation. Restarting clears the in-memory queue and resets the execution counters; a fresh Codex call is needed afterwards to produce collectable records.

Queue limits: records live in memory and are lost when CLIProxyAPI restarts; reading consumes them, so this dashboard must remain the queue's only consumer — do not run another usage statistics service (such as CPA Usage Keeper) against the same instance or records will be split between consumers. The success and failed execution counters also live in runtime memory and reset on restart.

When the CLIProxyAPI source is due, the Worker uses the `auth_index` of one available Codex account to read its ChatGPT quota. CLIProxyAPI keeps and applies the account credential. The source refresh interval and the five-minute Worker Cron determine the polling cadence. Quota changes from direct Codex activity appear in the rings after the next successful read. Daily usage still comes from the CLIProxyAPI queue. Cost estimates are unavailable.

The upstream service may return only some windows. Administrators can see the last recorded value and its original timestamp after it expires. Missing windows wait for upstream data, and quota signals from ordinary model responses can supplement scheduled reads.

### Codex usage display: dashboard behavior

Scheduled collection reads credentials, then pops the queue once under the source lease (up to 50 records per run). Saved-source tests, draft tests and save-time checks read credentials only and never consume the queue. Only Codex records whose auth_index matches an existing account through the existing HMAC identity key count toward the totals. Other providers and missing/unmatched account identities are discarded.

Input, output, reasoning, cached and total tokens, requests and failures accumulate by the timestamp's UTC day. Upstream counters are preserved; reasoning and cached counts are not added into total again. Daily aggregates persist across dashboard restarts and retain the latest 400 UTC days. coverageStart is the start of the earliest retained day, not a promise of complete coverage. The card shows the latest day; details show the full daily sequence, subject to existing Codex module and usage-field permissions.

An empty queue preserves previous totals. Queue 400/404 responses mean statistics are unavailable and do not fail account collection. CLIProxyAPI restarts, queue retention/capacity limits and the 50-record-per-run limit can lose or omit unconsumed records. A failed database commit or changed source revision/lease after a pop loses that batch: upstream provides no acknowledgement or replay, and the batch is never retried independently. These are successfully saved observations, not official account-wide usage or quota.

estimatedCost remains unavailable because the queue does not establish actual settlement rates, routing discounts or cache/reasoning billing rules. Model names and token counts alone cannot establish reliable cost. Existing passive quota observations remain independent. Raw queue records never enter storage, logs or public responses.

### Tailscale devices

Tailscale and Sleepy are independent modules. Tailscale is disabled by default and ordered between Devices and Codex.

1. Create an OAuth Client in Tailscale Trust credentials with only `devices:core:read`.
2. Under Data sources → Add source, select Tailscale. Enter the OAuth Client ID and Client Secret, enable the source in its header, and select Save configuration. The preset supplies the official URL, authentication scheme and target approval.
3. Enable the Tailscale Dashboard module and bind its main source to that integration. Set the module to public if guests should see the devices.
4. Choose whether IP addresses are visible, hidden, or visible after login. The default is after login. Hidden addresses appear as `****`; the server does not send their real values to unauthorized viewers.

Connection status uses `connectedToControl`. It describes the control-plane connection and does not prove service reachability. This API does not supply foreground apps or battery data; Sleepy continues to handle those. The Collector calls the official API without joining the tailnet. Each run POSTs to the fixed official `/api/v2/oauth/token` endpoint for a read-only token, then GETs the device list. The Client Secret goes to that token endpoint, and redirects are rejected.

### Default Tencent quotes

Fresh databases automatically load the enabled source `tencent`, with provider `quotes-custom`, protocol `tencent-us-v1`, root `https://web.ifzq.gtimg.cn/` and a 300-second refresh interval. QQQM, VOO and the Quotes module's `main` reference are bound to it. The default source has a saved admin approval and needs no API key or extra Worker variable.

1. Use the deployment command in this README to apply migrations and load the default Tencent source.
2. On existing sites without a source named `tencent`, the migration loads the default source and switches QQQM/VOO's default Yahoo bindings and the Quotes module's default Yahoo reference to Tencent. Yahoo is disabled when no other enabled references remain; its credentials, snapshots and cooldown records remain stored. An existing `tencent` source, custom bindings and configurations already at the ten-source limit remain unchanged. Changes increment the config version and create a system audit record; reload admin drafts opened before the upgrade.
3. Run the read-only connection test, then wait for collection. The test reads one symbol; the dashboard reads persisted Collector results. Node.js deployments can run `pnpm collector:node`.

This Tencent protocol supports US symbols. `US / QQQM` and `US / VOO` map to the observed exchange-qualified codes `QQQM.OQ` and `VOO.AM`. Other symbols require a verified full code, such as `AAPL.OQ`; unknown bare tickers, Chinese and Hong Kong markets are unsupported. Each symbol uses one request for both quotes and five daily bars. A source supports at most 20 symbols within a 10-second total read deadline.

Daily changes use the response's previous close. Prices remain decimal strings. US quote timestamps use `America/New_York` and are stored as UTC; pages format them in the site timezone. History contains forward-adjusted daily closes, with local midnight anchoring each trading date. The quote's observation time comes from its separate upstream timestamp. Unknown delay durations remain unknown. Old quotes become stale and failed reads retain the last valid snapshot.

The endpoint is an unversioned Tencent stock-page service with unconfirmed public display rights. Yahoo's `yahoo-chart-v8` protocol and both mirrors remain available for manual selection, with no automatic fallback. The saved admin target approval controls access.

### Updates and troubleshooting

Push code to the production branch to rebuild and deploy connected Workers. The deploy command applies new `migrations/*.sql` automatically, so no manual migration step is required; to verify early or take a backup first, run the migration command from step 3, which skips files already applied. Before migrations, review Time Travel or export a backup from D1. If you enable a custom domain, update `AUTH_ORIGIN` to its actual HTTPS origin.

| Symptom                                          | Check                                                                                                                                                                         |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker name mismatch during build                | The dashboard Worker name matches `name` in the configuration used by that deployment                                                                                         |
| Unsupported Node.js or pnpm version              | Version build variables and the `pnpm build` command                                                                                                                          |
| Dashboard API returns 503 or storage unavailable | Correct Database ID, completed cloud migrations, and `DB` bound to `nozoki-db`                                                                                                |
| Login temporarily unavailable                    | `AUTH_ORIGIN` matches the address bar, and both login secrets are in runtime settings                                                                                         |
| Cannot log in after binding a custom domain      | `AUTH_ORIGIN` updated to the custom domain and redeployed; before that, any password is rejected when visiting through the custom domain instead of the `workers.dev` address |
| Incorrect email or password                      | Email matches `ADMIN_EMAIL`; password matches the configured Secret                                                                                                           |
| Source unconfigured or target not approved       | Source settings and fixed relay configuration                                                                                                                                 |

See Cloudflare's [Git deployment](https://developers.cloudflare.com/workers/ci-cd/builds/), [D1 database](https://developers.cloudflare.com/d1/get-started/) and [Secret settings](https://developers.cloudflare.com/workers/configuration/secrets/) documentation for dashboard details.

## Self-hosting on a server

Use Node.js 24.21.0, pnpm and a persistent local disk. SQLite uses Node's built-in `node:sqlite` module, with no separate database service. Server builds go to `.output-node/`. The Cloudflare `pnpm build` command continues to use `.output/`.

### Build and start

```sh
pnpm install --frozen-lockfile
pnpm build:node
cp .env.example .env
```

Edit `.env` using [.env.example](.env.example). Set the administrator credentials and an absolute `NOZOKI_SQLITE_PATH`, such as `/var/lib/nozoki/nozoki.sqlite`. The runtime account must own the data directory. Generate the password and each random key independently. Git ignores `.env` and database files.

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
pnpm db:migrate:node
pnpm start:node
```

The default listener is `127.0.0.1:3000`. For local HTTP testing, use `AUTH_ORIGIN=http://127.0.0.1:3000` and `AUTH_ALLOW_LOCAL_HTTP=1`. Public deployments require an HTTPS origin and `AUTH_ALLOW_LOCAL_HTTP=0`.

You can copy the complete `.output-node/` directory to the server and run it directly. Runtime paths resolve relative to the bundle:

```sh
node --env-file=/etc/nozoki/nozoki.env /opt/nozoki/.output-node/database.mjs migrate
node --env-file=/etc/nozoki/nozoki.env /opt/nozoki/.output-node/start.mjs
```

The runtime account needs read access to the bundle and secret files, plus write access to the database directory. Use mode `600` for secret files. Keep the data directory outside the release directory when updating the application. The first migration creates a separate SQLite database. Existing D1 data requires an explicit export and conversion; startup does not import it automatically.

### HTTPS and process management

The Node service binds to loopback. Run Caddy or Nginx on the same host for HTTPS, preserving the browser's Host header. Its hostname and port must match `AUTH_ORIGIN`. For example, with Caddy:

```caddyfile
dashboard.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Authentication derives the public request target from the configured HTTPS origin. Forwarded host, protocol, IP and Cloudflare IP headers are not trusted. Node deployments use a conservative shared source-limit bucket alongside the administrator account limit. Public HTTPS sessions use the Secure, HttpOnly, SameSite=Strict `__Host-nozoki_session` cookie.

On Linux, systemd can manage the process. Create a `nozoki` runtime account, grant access to the data directory, and adjust the Node and installation paths in `/etc/systemd/system/nozoki.service`:

```ini
[Unit]
Description=Nozoki dashboard
After=network-online.target

[Service]
User=nozoki
WorkingDirectory=/opt/nozoki
EnvironmentFile=/etc/nozoki/nozoki.env
ExecStart=/usr/bin/node /opt/nozoki/.output-node/start.mjs
Restart=on-failure
UMask=0077
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

### Collection and public sources

Run one collection pass:

```sh
pnpm collector:node
```

The web and collection processes must share `NOZOKI_SQLITE_PATH`, decryption keys and connector settings. Set `COLLECTOR_EPOCH` to a positive integer and increment it when changing deployment encryption keys or the connector. Credential edits in the admin page take effect through source revisions. Each invocation checks due sources within a five-minute scheduling window, using the same leases, revision checks, backoff and commit guards as the D1 implementation.

To automate collection, the runtime account can add a system Cron entry with the actual environment and installation paths:

```cron
*/5 * * * * /usr/bin/node --env-file=/etc/nozoki/nozoki.env /opt/nozoki/.output-node/collector.mjs
```

Collection also performs bounded hourly retention cleanup. Configure scheduled tasks on the server. Approved public sources use restricted outbound requests inside the process. Tailscale OAuth uses fixed official endpoints. The web and collection processes must share integration encryption keys. See the migration instructions above for legacy sources.

### Backups and upgrades

```sh
pnpm db:backup:node /var/backups/nozoki/manual.sqlite
```

Backups use SQLite online backup and verify the result with `quick_check`. The destination must not already exist. Before an upgrade, take a backup, stop both the web service and collection task, replace the application, run `db:migrate:node`, then restart. The migration runner uses the shared SQL files, one transaction per migration, and records SHA-256 checksums. Before pending migrations on an existing managed database, it creates a consistent backup in the data file's sibling `backups/` directory. Set `NOZOKI_BACKUP_DIR` to choose another location.

To restore, stop both processes, restore a complete backup to a new data path and update `NOZOKI_SQLITE_PATH`. Use the backup command to copy a database that is being written. Store the database, WAL and shared-memory files on the same local disk; containers need a persistent data volume. This deployment targets a single host. SQLite uses WAL, FULL synchronization and a one-second lock timeout; sustained write contention fails and rolls back the request.

## Project layout

```text
app/                 Vue pages, components, styles and composables
server/              APIs, authentication, configuration, repositories, adapters and collection
shared/
  contracts/         Runtime validation and shared types
  schedule/          Portable schedule engine
  device-state/      Device status and battery parsing
  collection/        Collection timing and result rules
  domain/            Balance calculations and view data conversion
platform/node/       Node HTTP entry, SQLite, migrations and one-shot collector
migrations/          Shared D1 and server SQLite SQL migrations
scripts/             Build, local runtime and asset generation scripts
tools/               Local read-only relay
tests/               Unit, D1, browser and portability tests
public/              Static assets, fonts and third-party notices
.dev.vars.example    Local environment template
.env.example         Server environment template
.gitignore           Local files and build output exclusions
.gitattributes       Text line-ending rules
```

## Development checks

Routine checks:

```sh
pnpm test
pnpm typecheck
pnpm format:check
```

For D1 or Worker API changes, run `pnpm build`, then `pnpm test:d1`. Tests reuse the existing build. For self-hosted server changes, run `pnpm build:node`, then `pnpm test:node`. Both test groups run without a browser by default. Build and deployment commands run independently.

Run `pnpm test:browser` when interaction checks are needed, after building both Worker and Node targets. Tests use Microsoft Edge by default; set `PLAYWRIGHT_EXECUTABLE_PATH` to select another browser. Run `pnpm test:layout` against a running local preview for layout changes. Screenshots go to the ignored `.wrangler/test-results/` directory.

`pnpm theme:generate` generates the default M3 palette. `pnpm dx:generate` generates the early loading script. Development and build commands run their preparation hooks.

## License

Project code is licensed under [MIT](LICENSE). Third-party licenses are in [public/licenses/](public/licenses/).

Loading animation: [maimai-transition](https://github.com/gfdfdxc/maimai-transition).
