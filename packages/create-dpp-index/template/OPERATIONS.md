# Operating this project with automation

Read `README.md` first. The release set and generator version are in `package.json` under `dpp`. Keep the pins and `package-lock.json` together when upgrading.

```sh
npm test
node scripts/doctor.mjs --json
npm run up
node scripts/doctor.mjs --online --json
node scripts/connection.mjs --json
```

The Node commands produce JSON and return a non-zero status on failure. `doctor` is read-only. Offline success checks configuration; online success adds HTTP capabilities. Neither establishes successful application writes, settlement, database durability after a failure, or production readiness.

`connection` creates or replaces `.app.env` with private server-side settings. It does not print tokens. Do not paste `.env`, `.app.env`, MongoDB URIs, export keys or advertiser keys into logs, reports or browser code. Read environment variable names from `.env.example` without exposing their populated values.

Keep header verification enabled. Do not resolve admission failures by bypassing it, clearing publisher restrictions or adding control authorities. Match the app's publisher public key, network, custody profile and token scopes, then inspect the actual refusal.

The starter starts no funded wallet and broadcasts no transaction. Advertising is an explicit optional extension. It requires a separate wallet and funding. The app and registry own their own duties and backups.

Do not delete volumes to fix startup. MongoDB initial credentials only apply when its volume is new. Use the documented recovery rehearsal and preserve the old deployment until its data has been checked.
