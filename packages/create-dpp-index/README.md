# @bsv/create-dpp-index

Create an independently editable operator project for the DPP index. It contains MongoDB, deployment files, checks and an app connection helper. **The starter includes `@bsv/dpp-overlay-topics` as the project's runtime dependency. There is no separate runtime installation step.** One index serves both passport and attestation topics.

If your app uses an existing compatible index, obtain its URL and access settings from its operator; you need neither the starter nor the runtime package just to connect over HTTP.

This source candidate has not been published. After the starter and its pinned dependencies are published, this single command creates the project and installs its dependencies:

```sh
npm create @bsv/dpp-index@0.1.0-beta.1 my-index
```

The guided path asks for the publisher **public** key, network and custody profile. Get that identity key from the app's wallet. It is not the app user's identity or a private wallet key. Managed custody is the default to match the app starter.

For scripts and agents:

```sh
npx @bsv/create-dpp-index@0.1.0-beta.1 my-index --publisher-key "$PUBLISHER_PUBLIC_KEY" --network main --yes --no-install --json
```

`--config settings.json` accepts `publisherKey`, `anchorKeys`, `network`, `custody`, `port` and `publicUrl`. Flags override the file. Invalid or missing settings and non-empty targets fail without overwriting existing work. `--no-install` scaffolds offline; dependency installation requires registry access. Installation failure returns non-zero and preserves the generated project for retry. `--help` lists all options.

Inside the result, run `npm test`, `npm run up`, `npm run doctor -- --online`, then `npm run connection`. Run `npm install --ignore-scripts` first only if you used `--no-install` or installation needs a retry. The last command saves `.app.env` with `INDEX_URL`, `INDEX_SUBMIT_TOKEN`, `INDEX_CALLBACK_TOKEN` and the matching `NETWORK` for the app. No secrets are printed.

The generated README explains local startup, hosting, optional peers and discovery, backup and recovery. `OPERATIONS.md` gives the automation commands and boundaries. The runtime uses header verification by default; an empty local index is not a claim of on-chain publishing.

## Package boundary

The starter creates your project; the included runtime runs it. `@bsv/dpp-overlay-topics` is a separate maintained package so the generated project can receive runtime upgrades through its dependencies. You select it directly only when building a [custom or embedded index](../overlay-topics/README.md).

The generated project directly depends on `@bsv/dpp-overlay-topics`. That package brings the compatible `@bsv/dpp-protocol`, `@bsv/dpp-profiles`, overlay engine, SDK and MongoDB driver automatically. The generator itself has no runtime dependencies and is not a service you keep running.

Application auth, the application database, wallet funding, claim storage and resolver deployment are separate responsibilities. A second index is optional, as are static peers, SHIP discovery and funded SHIP/SLAP advertising. The index does not need a funded wallet unless advertising is deliberately enabled.

## Develop and check the candidate

From the repository root:

```sh
npm ci
npm run build
npm test -w @bsv/create-dpp-index
npm run index-starter:check
```

The last check packs the generator and current runtime packages, creates a project outside the monorepo, installs those tarballs, starts the generated service against temporary MongoDB and exercises HTTP configuration, admission and restart behaviour. It writes no registry package or live blockchain transaction. The packed candidate path is printed when `KEEP_INDEX_STARTER=1` is set.

To also check a generated app, build it first and pass its absolute path:

```sh
npm run index-starter:check -- --app-project /absolute/path/to/my-dpp
```

This uses the app's built index client to check access settings and retrieve a synthetic passport before and after an index restart. In the app starter checkout, `KEEP_DPP_APP=1 npm run starter:check` retains a generated, built app for this check.

The generator is released separately from the protocol release set named under `dpp` in its manifest. Publish that dependency set first, then this generator.

## Prepare a release

Use Node 22.23.3 and npm 11.19.0, matching `.github/workflows/publish-index-starter.yaml`. From the repository root:

```sh
npm run index-starter:check
npm run index-starter:release
```

The release command builds and packs the starter and its pinned runtime dependencies into the ignored `release/index-starter/` directory. It writes `publication-plan.json` and prints its SHA-256. Local preparation publishes nothing and works before the runtime is on npm. The plan binds the source revision, archive bytes, dependency release set, npm tag, authentication method and provenance choice.

After the runtime packages are published, check their exact registry bytes and exercise the candidate starter against them:

```sh
npm run index-starter:release -- --check-registry
npm run index-starter:check -- --registry-dependencies
```

A missing or changed runtime archive stops the release. The starter workflow never publishes those dependencies itself. The registry check uses a fresh npm cache and lets the generator install its declared dependencies; it does not substitute local runtime archives.

### Publish the reviewed candidate

Publication requires a clean committed revision and explicit approval of its exact plan digest. Working-tree plans are for review and testing only. Commit, push and publication each require their own approval.

For a package with trusted publishing configured, run **Publish index starter** with `dryRun: true`. Review the uploaded plan and archives, then run it on the same revision with `dryRun: false` and the approved SHA-256. Configure the package's npm trusted publisher for organisation `bsv-blockchain`, repository `dpp`, workflow filename `publish-index-starter.yaml`, no deployment environment, and permission for `npm publish`. The workflow uses GitHub OIDC and publishes the starter under `next`; it does not need a stored npm token.

For the first publication of a new package name, an npm scope maintainer may need to establish the package before trusted publishing can be configured. Prepare that as a separate interactive plan from the same clean checkout:

```sh
npm run index-starter:release -- --check-registry --authentication=interactive --provenance=false
```

This changes the plan digest and explicitly records the absence of CI provenance. Only after that exact plan is approved, the maintainer can run the same command with `--execute --approval=<approved-sha256>` in an authenticated terminal and complete npm's prompts. The script retains the same source, dependency and archive checks. Configure trusted publishing afterwards; an authentication failure never triggers an automatic fallback or a placeholder release.

After publication, the workflow verifies the uploaded archives and runs:

```sh
npm run index-starter:release -- --verify-registry
npm run index-starter:check -- --registry
```

The final check runs the documented `npm create @bsv/dpp-index@<exact-version>` command in a fresh directory with a fresh cache, installs from public npm, and exercises startup, configuration, access scopes, persistence and retry behaviour. It fails if a package is missing; local candidates are never a fallback. Synthetic admission tests remain separate from header-verified startup and establish no blockchain inclusion. Neither check funds a wallet or publishes a blockchain transaction.

If publication is interrupted, retain the approved revision and plan. A repeat skips an existing npm version only when the downloaded bytes match; it refuses a conflicting version. Complete the registry checks before announcing the release. The [repository release guide](../../release/README.md#index-starter-publication) records the order across the runtime and starter releases.

## Licence

Apache 2.0.
