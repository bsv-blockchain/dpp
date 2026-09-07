# Install the selected release

The [selected release](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/release/dpp-release-2026-09-3.json) is a candidate. Use its packed artefacts; repository publication remains open. The [support table](support-table.md) identifies entry points and runtimes.

The first examples run from a source checkout. Packing is needed when another application will install these local candidate packages. No public package publication is implied.

## Source access

These guides reference source revision `8691c12c6e81f54216ec30fe4c688f5d1b82b644`. A reader with repository access can obtain it with:

```sh
git clone https://github.com/bsv-blockchain/dpp.git
cd dpp
git checkout --detach 8691c12c6e81f54216ec30fe4c688f5d1b82b644
npm ci
npm run build
```

Once the build succeeds, go directly to the [offline quick start](../quick-start.md). Keep the terminal at the repository root.

For source inspection when needed, a pinned file can also be read locally:

```sh
git show 8691c12c6e81f54216ec30fe4c688f5d1b82b644:spec/record-model.md
```

Use the path following the commit hash in each source URL. Links to another repository need access to that repository. The [BSV Association contact page](https://bsvassociation.org/contact/) handles access enquiries; publication remains open.

## Pack and check

From that checkout:

```sh
node scripts/release-candidates.mjs
node scripts/consumer-check.mjs
```

The [candidate tooling](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/scripts/release-candidates.mjs) writes the source revision and artefact digests to `release/candidates.json`. The [consumer check](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/scripts/consumer-check.mjs) installs and exercises those tarballs in a separate project.

To print the produced tarball paths, run:

```sh
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
const record = JSON.parse(readFileSync('release/candidates.json', 'utf8'))
for (const candidate of record.candidates) console.log(candidate.name, resolve('release/candidates', candidate.filename))
JS
```

In the consuming application's directory, run `npm install /absolute/path/to/the-produced-package.tgz` for the packages it needs, replacing the path with the corresponding output above. Preserve the resulting lockfile. Use [quick starts](../quick-start.md) from the repository checkout, or select a package:

| Task | Package |
|---|---|
| Passport records and shared evidence | [Core](dpp-core.md) |
| Product profiles and projections | [Profiles](dpp-profiles.md) |
| Credentials and source events | [VSC](vsc.md) |
| Index services | [Overlay](dpp-overlay-topics.md) |

The [application service](application-service.md) is maintained separately from this release set.
