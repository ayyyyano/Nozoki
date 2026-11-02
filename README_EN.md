# Nozoki

[简体中文](README.md)

Nozoki is a personal dashboard for Cloudflare Workers or a Node.js server. Nuxt 4 runs the pages and server APIs. Cloudflare deployments use D1; server deployments store settings, sessions and snapshots in a local SQLite file.

The interface uses Varlet Material 3 and xicons Material. It supports generated theme colors, banner or full-page backgrounds, wallpaper mode and loading transitions. The account button on the home page opens the administrator login form.

## Dashboard modules

| Module   | Content                                                                                                   |
| -------- | --------------------------------------------------------------------------------------------------------- |
| DeepSeek | Account balances, currencies, topped-up balances and granted balances                                     |
| Devices  | Sleepy status text, identifiable foreground applications, optional battery and external power information |
| Codex    | CLIProxyAPI account status and passive quota observations supplied by the source                          |
| Activity | Weekly schedules, multiple periods, templates, date exceptions, countdowns and progress                   |
| Quotes   | Tencent prices, daily changes, volume and five-day history                                                   |
| Links    | Bookmarks, ordering and Material icons                                                                    |
| Services | Uptime Kuma and UptimeFlare monitor status and latency                                                    |

The admin interface controls module availability, ordering, titles and access permissions. The server filters data for the current session. Visitor requests read saved results from the database.

Each source needs an address, a supported protocol version and any required credentials. Deployment administrators can approve public HTTPS sources for direct access. Private sources on Cloudflare use a fixed VPC Service and a read-only relay. Node.js can run the relay inside the server process. QQQM and VOO use the enabled Tencent source by default. DeepSeek balance changes are separate from official billing records. Codex token usage and costs require a trusted source.

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

Build and run the Collector locally with:

```sh
pnpm collector:typecheck
pnpm collector:build
pnpm collector:preview
```

The local Collector listens at http://127.0.0.1:8788. Scheduled events trigger collection; HTTP requests return 404. Dashboard and Collector local commands share `.wrangler/state`. They also need the same `database_id` to use the same database.

Nuxt builds clear `.output`, so build the Collector after `pnpm build`. Collection uses D1 leases and source revision checks. A failed attempt keeps the last valid snapshot and records the error separately.

## Quick deployment with an agent tool

Send the whole prompt below to an AI agent that can run commands in the project directory, such as Codex CLI or Claude Code. The agent completes the first deployment with wrangler and then binds the Worker to your GitHub repository, so later pushes build and deploy automatically. `wrangler login` requires one browser authorization; the Git binding needs one connect confirmation in the Cloudflare dashboard (including the GitHub App authorization). All other steps run in the terminal. Skip to the next section if you prefer doing each step by hand.

```text
Deploy the Nozoki dashboard in the current directory to Cloudflare Workers and bind the Worker to my GitHub repository by default, so future pushes build automatically. Use the command line only apart from the final Git binding step, which I confirm in the dashboard; do not open the Cloudflare dashboard for anything else. Ask me before creating any cloud resource. Before starting, read the "Administrator configuration" and "Deploy to Cloudflare from GitHub" sections of README_EN.md. This flow commits and pushes the deployment configuration to my repository.

Preparation:
1. Check for Node.js 24 and Git. Install pnpm with npm install --global pnpm@12.15.0 if it is missing, then run pnpm install --frozen-lockfile.
2. Ask me for the administrator email, then run pnpm exec wrangler login and finish the browser authorization.

Cloud resources:
3. Run pnpm exec wrangler d1 create nozoki-db. Put the returned database_id into the root wrangler.jsonc and set ADMIN_EMAIL in vars to that email. The file currently holds local placeholder values; replace it with the template from step 2 of the next section if that is easier.
4. Run pnpm exec wrangler d1 migrations apply DB --remote --config wrangler.jsonc to create the cloud tables.

Build and deploy:
5. Run pnpm build and then pnpm exec wrangler deploy --config wrangler.jsonc. Record the workers.dev address from the output.
6. Add that address as AUTH_ORIGIN in the vars of wrangler.jsonc and run the deploy command again.
7. Run node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))" to generate one secret and set it as AUTH_RATE_LIMIT_SECRET with pnpm exec wrangler secret put. Ask me for the administrator password. Supply both values through interactive input or stdin; never write them to files, command-line arguments or your reply.
8. Verify the deployment: request the address from step 5 and confirm the dashboard responds, sign in at /admin with the administrator email and password, change the site name, save and refresh to confirm the change persists. Report the result and anything unfinished.

Git binding for automatic builds:
9. Run git remote -v to confirm the local remote points to my repository; ask me for the repository URL and run git remote add origin if none exists. Commit every change to the root wrangler.jsonc and push it to the production branch (master by default; use the repository's actual default branch otherwise). Then guide me through the one-time connection in the Cloudflare dashboard: open nozoki-dashboard → Settings → Builds → Connect, finish the GitHub authorization as prompted, select the repository, keep the production branch identical to the push branch, set the build command to pnpm build and the deploy command to pnpm exec wrangler deploy --config wrangler.jsonc (matching step 4 of the next section), save, wait for the first build to finish and report the result. After that, updates only need a commit and push; the Worker builds and deploys automatically.

Credential encryption (only when I ask for it):
10. Run node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))" to generate an independent secret and set it as INTEGRATION_ENCRYPTION_KEY on nozoki-dashboard with pnpm exec wrangler secret put. Add INTEGRATION_KEY_VERSION=v1 to the vars of the root wrangler.jsonc, then commit and push the change (run the deploy command instead when step 9 has not been completed). Supply the secret through interactive input or stdin only, and remind me to store it in a password manager; losing it prevents decryption of saved credentials. If the secret was not retained and no encrypted credentials exist yet, generate a fresh one and set the same value on both Workers.

Scheduled collection (only when I ask for it):
11. Edit workers/collector/wrangler.jsonc as described in step 6 of the next section: fill in the same database_id, remove "remote": false, and add top-level vars COLLECTOR_EPOCH=1 and INTEGRATION_KEY_VERSION=v1. Run pnpm collector:build and pnpm exec wrangler deploy --config workers/collector/wrangler.jsonc. Then set the same INTEGRATION_ENCRYPTION_KEY from step 10 on nozoki-collector with wrangler secret put; when step 10 was skipped or its secret was not retained, generate a fresh one and set the same value on both nozoki-dashboard and nozoki-collector. After deploying, wait for the next five-minute boundary and run pnpm exec wrangler d1 execute DB --remote --command "SELECT COUNT(*) FROM collector_environment" --config wrangler.jsonc to confirm one row exists, which verifies the cron is live; with no data sources configured yet, an empty collection run is expected.

Security: passwords and secrets belong only in Worker Secrets and Git-ignored local files. Never commit them, and never echo them into logs or your reply.
```

## Deploy to Cloudflare from GitHub

Steps 1 through 5 give you a working website with administrator login and saved settings. Step 6 adds automatic collection and can be configured later. You need GitHub and Cloudflare accounts. Cloudflare provides a `workers.dev` address, so you can start without your own domain.

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
  "compatibility_flags": ["nodejs_compat"],
  "workers_dev": true,
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
git push origin main
```

Use your actual branch name if it differs from `main`. GitHub Desktop can also commit and push these changes. Database contents stay in Cloudflare and are not uploaded to GitHub.

### 4. Import the repository into Workers

In Cloudflare, open **Workers & Pages → Create application → GitHub**. Authorize access to your repository and select it. Use the Workers repository deployment flow with these settings:

| Setting           | Value                                                   |
| ----------------- | ------------------------------------------------------- |
| Worker name       | `nozoki-dashboard`, matching `name` in `wrangler.jsonc` |
| Production branch | `main`, or your actual branch                           |
| Root directory    | Repository root; keep the default                       |
| Build command     | `pnpm build`                                            |
| Deploy command    | `pnpm exec wrangler deploy --config wrangler.jsonc`     |

The repository pins Node.js and pnpm through `.node-version` and `package.json`. If the dashboard requires explicit versions, set build variables `NODE_VERSION=24.21.0` and `PNPM_VERSION=12.15.0`. Use `pnpm build` for Cloudflare; `build:node` is for server self-hosting.

Select **Save and Deploy**, wait for a successful build, then open the supplied `https://nozoki-dashboard.your-subdomain.workers.dev` address. The dashboard should load. The next step enables administrator login.

### 5. Set the login address and secrets

Copy the site's full HTTPS address and add `AUTH_ORIGIN` to the root configuration's `vars`, keeping your own administrator email:

```jsonc
"vars": {
  "ADMIN_EMAIL": "you@example.com",
  "AUTH_VERSION": "1",
  "AUTH_ALLOW_LOCAL_HTTP": "0",
  "AUTH_ORIGIN": "https://nozoki-dashboard.your-subdomain.workers.dev"
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

### 6. Set source credentials and automatic collection

To save API keys in the admin interface, run the random-secret command from step 5 again to generate an independent encryption key. Add it as the Dashboard's runtime Secret `INTEGRATION_ENCRYPTION_KEY`. Add `"INTEGRATION_KEY_VERSION": "v1"` to the root Wrangler `vars` and push the change. Save this key in a password manager; losing it prevents decryption of existing credentials.

The Collector is a second Worker that collects data and removes expired sessions and old logs. When ready, edit [workers/collector/wrangler.jsonc](workers/collector/wrangler.jsonc):

- Replace `database_id` with the same Database ID from step 2.
- Remove `"remote": false` from that D1 binding.
- Add `"vars": { "COLLECTOR_EPOCH": "1", "INTEGRATION_KEY_VERSION": "v1" }` at the top level. Merge these fields if `vars` already exists.

Publish it from your local terminal:

```sh
pnpm exec wrangler deploy --config workers/collector/wrangler.jsonc
```

This enables the configured five-minute Cron. Each source keeps its own refresh interval; disabled sources and sources without enabled module references are skipped. In **nozoki-collector → Settings → Variables and Secrets**, add Secret `INTEGRATION_ENCRYPTION_KEY` with the same value as the Dashboard, then select **Deploy**. The Collector does not need the administrator password.

For automatic updates on GitHub pushes, commit the Collector configuration, then open **nozoki-collector → Settings → Builds → Connect** and connect the same repository. Keep the repository root, use build command `pnpm collector:build` and deploy command `pnpm exec wrangler deploy --config workers/collector/wrangler.jsonc`.

A 404 at the Collector's web address is expected. Results appear on the dashboard; execution details are in the Worker's logs. DeepSeek needs your API key. Public Sleepy, Kuma and Flare sources can use the direct routes below. CLIProxyAPI management interfaces and private network sources use a fixed VPC Service and read-only relay. Increment `COLLECTOR_EPOCH` when changing collection keys, routes or binding revisions.

### Approving public HTTPS sources

Save the source in the admin page and note its ID, provider, protocol version and full service root. Set the same `NOZOKI_PUBLIC_ROUTES` JSON string in the Dashboard and Collector runtime variables. For Node.js, use the environment file shared by the server and collection processes. Example:

```json
[
  {
    "id": "my-sleepy",
    "provider": "sleepy",
    "protocolVersion": "sleepy-v5-status",
    "baseUrl": "https://sleepy.example.com/",
    "authentication": "none"
  }
]
```

Replace the example with your confirmed source. Matching includes the service root path: `/service-a/` and `/service-b/` are different targets. A configuration can contain up to 10 sources. Update the deployment variable after changing a source address, provider or protocol. Mismatched targets are rejected. Use `none` for public status interfaces. Use `bearer` when your own read-only proxy requires a Bearer Token, and save that source credential separately in the admin page. The `none` mode sends no stored credential.

Before approval, confirm that a trusted operator controls the domain, DNS and service, that the destination is on the public network, and that its TLS certificate is valid. Direct access uses fixed HTTPS roots and registered read-only endpoints. IP literals, local host names, nonstandard ports and redirects are rejected. Connections still resolve the approved host name at runtime; DNS/IP pinning is not provided. Use the constrained relay for DNS rebinding risks, split DNS into private networks, or uncertain network placement. Cloudflare proxying or Tunnel does not replace this check. Keep the full CLIProxyAPI management interface off the public internet.

Increment `COLLECTOR_EPOCH` when upgrading an existing Collector to this policy, changing public routes or changing the built-in public service catalog. A changed configuration fingerprint under the same epoch fails the internal check, and the collection report returns `COLLECTION_UNAVAILABLE`. The fixed DeepSeek, Tencent and Yahoo roots have built-in approval. Other sources require an approved route; a route cannot enable an unknown protocol.

### Default Tencent quotes

The enabled default source has ID `tencent`, provider `quotes-custom`, protocol `tencent-us-v1`, root `https://web.ifzq.gtimg.cn/` and a 300-second refresh interval. QQQM, VOO and the Quotes module's `main` reference are bound to it. The exact root has built-in approval and requires no API key or `NOZOKI_PUBLIC_ROUTES` entry.

1. Apply migrations including `0014_default_tencent_source.sql`, then update the Dashboard and Collector together. Increment `COLLECTOR_EPOCH` for an existing Collector because the built-in target catalog changed.
2. Fresh databases use Tencent. On a site with saved configuration, add and enable a source with ID `tencent` using the protocol and root above. Set QQQM and VOO's Provider and the Quotes module's `main` reference to `tencent`, disable Yahoo, then save. The new source has its own schedule; Yahoo's rate-limit cooldown remains attached to the old source.
3. Run the read-only connection test, then wait for collection. The test reads one symbol; the dashboard reads persisted Collector results. Node.js deployments can run `pnpm collector:node`.

This Tencent protocol supports US symbols. `US / QQQM` and `US / VOO` map to the observed exchange-qualified codes `QQQM.OQ` and `VOO.AM`. Other symbols require a verified full code, such as `AAPL.OQ`; unknown bare tickers, Chinese and Hong Kong markets are unsupported. Each symbol uses one request for both quotes and five daily bars. A source supports at most 20 symbols within a 10-second total read deadline.

Daily changes use the response's previous close. Prices remain decimal strings. US quote timestamps use `America/New_York` and are stored as UTC; pages format them in the site timezone. History contains forward-adjusted daily closes, with local midnight anchoring each trading date. The quote's observation time comes from its separate upstream timestamp. Unknown delay durations remain unknown. Old quotes become stale and failed reads retain the last valid snapshot.

The endpoint is an unversioned Tencent stock-page service with unconfirmed public display rights. Protocol parsing and local fixture collection are implemented; deployed Workers connectivity and sustained data behavior still need verification. Yahoo's `yahoo-chart-v8` protocol and both mirrors remain available for manual selection, with no automatic fallback. Remove or update any `NOZOKI_PUBLIC_ROUTES` override that conflicts with the new source.

### Updates and troubleshooting

Push code to the production branch to rebuild and deploy connected Workers. If an update adds `migrations/*.sql`, run the migration command from step 3 before deploying the new code. Applied migrations are skipped. Before migrations, review Time Travel or export a backup from D1. If you enable a custom domain, update `AUTH_ORIGIN` to its actual HTTPS origin.

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

### Collection and private sources

Run one collection pass:

```sh
pnpm collector:node
```

The web and collection processes must share `NOZOKI_SQLITE_PATH`, decryption keys and relay settings. Set `COLLECTOR_EPOCH` to a positive integer and increment it when changing collection keys, relay routes or binding revisions. Each invocation checks due sources within a five-minute scheduling window, using the same leases, revision checks, backoff and commit guards as the D1 implementation.

To automate collection, the runtime account can add a system Cron entry with the actual environment and installation paths:

```cron
*/5 * * * * /usr/bin/node --env-file=/etc/nozoki/nozoki.env /opt/nozoki/.output-node/collector.mjs
```

Collection also performs bounded hourly retention cleanup. The deployment bundle does not install or enable scheduled tasks. Configure public access with `NOZOKI_PUBLIC_ROUTES` as described above. Private sources require a statically configured read-only relay.

For the embedded relay, point `NOZOKI_RELAY_CONFIG_FILE` to a protected JSON file shaped as `{"sources":[{"source":{...},"credential":"..."}]}`. Each `source` follows IntegrationSettings validation: `id`, `provider`, `protocolVersion`, normalized HTTPS `baseUrl`, `enabled`, `refreshInterval`, `fieldMappings`, `capabilities` and `credentialState`. Upstream management secrets belong in the relay's `credential` field. Register the same source in `NOZOKI_PRIVATE_ROUTES` with `id`, `provider`, `protocolVersion`, `baseUrl`, `refreshInterval` and `fieldMappings`. These values must match the saved D1/SQLite configuration. Set an independent `NOZOKI_PRIVATE_RELAY_TOKEN` and a `COLLECTOR_BINDING_REVISION`. Codex account protocols also require a stable `NOZOKI_RELAY_ID_KEY`; put its SHA-256 hex digest in the route's `identityVersion`.

The embedded relay handles fixed requests inside the process, with no extra HTTP listener. TLS certificate verification remains enabled, and upstream requests use registered read-only paths. Sources without matching public approval or relay configuration return `TARGET_NOT_APPROVED`.

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
workers/collector/   Separate collection Worker
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

Choose checks that cover your changes:

```sh
pnpm typecheck
pnpm test
pnpm format:check
pnpm build
pnpm test:d1
```

`test:d1` builds the Collector and runs on isolated local workerd/D1 databases. Browser tests need a running local service. They use Microsoft Edge by default; set `PLAYWRIGHT_EXECUTABLE_PATH` to select another browser.

For server tests, run `pnpm build:node` followed by `pnpm test:node`. Tests use isolated SQLite files and cover transactions, cross-connection CAS, collection leases, authentication, CSRF, HTTP idempotency, restart persistence and browser saves.

```sh
pnpm test:browser
pnpm test:sliders
pnpm test:dx
```

`pnpm theme:generate` generates the default M3 palette. `pnpm dx:generate` generates the early loading script. Development and build commands run their preparation hooks.

## License

Project code is licensed under [MIT](LICENSE). Third-party licenses are in [public/licenses/](public/licenses/).

Loading animation: [maimai-transition](https://github.com/gfdfdxc/maimai-transition).
