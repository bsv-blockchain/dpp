# @bsv/dpp-core

**Experimental prerelease:** For implementation and interoperability testing. APIs may change significantly before a stable release. Pin exact package versions and retain your lockfile. This package is not declared production-ready. Package versions are separate from the specification, wire-format and frozen profile versions they implement.

The DPP standard's reference implementation for record versions 1 and 2, the
attestation rail and the verification report, and the only place in this
repository the standard's rules are implemented. Everything else in the
reference implementation imports it: the overlay topic manager admits outputs
by asking this package whether a state is valid, and the consuming
applications build and verify every record through it. An independent
implementation does not import it; it reproduces the same rules from `spec/`
and holds itself to the same `fixtures/`.

Standard v1 is v0 plus the JSON field conventions (`spec/record-model.md` §3,
fields 9 and 10). The 14-field layout and the
chain invariants are untouched from v0, which is why the suite here was ported
rather than rewritten.

## Install and consume

This is a pre-1.0 candidate. Once the release is published, install exact versions from npm:

```sh
npm install --save-exact @bsv/dpp-core@0.3.0-beta.1 @bsv/sdk@2.4.2
```

Node >=22 and ECMAScript modules are supported. Browser use of the runtime is untested. No source checkout or build of this package is needed after installation.

```js
import { PrivateKey, ProtoWallet } from '@bsv/sdk'
import { didKeyFromIdentityKey, signLifecycleClaim, verifyLifecycleClaim } from '@bsv/dpp-core'

const key = PrivateKey.fromRandom()
const claim = await signLifecycleClaim({
  claimFormat: 'dpp-lifecycle-v1',
  passportId: 'https://example.com/01/09521000000018/21/EXAMPLE',
  recordId: '0'.repeat(64), // Synthetic record identifier for this offline example.
  eventType: 'Origin',
  timestamp: new Date().toISOString(),
  issuer: didKeyFromIdentityKey(key.toPublicKey().toString()),
  issuerKeyId: 'example',
  profile: 'general',
  profile_version: 2,
}, new ProtoWallet(key))
console.log(verifyLifecycleClaim(claim))
```

This offline example creates a temporary key and signs a claim. Production callers supply their authorised signing capability. Signature verification alone does not establish authority, current status or blockchain inclusion.

The `@bsv/dpp-core/schemas/*` export carries the standard's JSON schemas. For example, load `@bsv/dpp-core/schemas/verification-report.schema.json` using a JSON import or Node's `createRequire`. The evidence export schema and its referenced evidence package schema are shipped together. They are data files and may also be used by other runtimes.

## Public API

`src/index.ts` re-exports the whole surface, so `@bsv/dpp-core` is the only
specifier anything needs:

| Module | What it owns |
|---|---|
| `codec.ts` | The 14-field version 1 layout and the 17-field version 2 layout, selected by field count: encode and decode per `spec/record-model.md` §3 and `spec/record-model-v2.md` §3 |
| `signatures.ts` | The canonical signature preimages: unframed for version 1 (§5), framed and domain-tagged for version 2 (`record-model-v2.md` §5) |
| `transition.ts` | Which operation may change what, state by state, for both versions: the version 2 control proof, the terminal `RETIRE` and the single upgrade transition |
| `owner.ts` | The owner and controller key, the linkage scalar, the owner-signed transfer of version 1 and the control proof of version 2 |
| `acceptance.ts` | The managed acceptance record `dpp-managed-acceptance@1` (`spec/managed-custody.md` §3): inspect, sign, commit and bind to the `TRANSFER` |
| `verifyChain.ts` | Chain verification from genesis, including SPV inclusion; `inspectChain` is the same loop reported finding by finding |
| `evidence.ts` | `verifyPassportEvidence`, the one verification contract of `spec/verification.md`: sixteen named checks, four answers each, an expected subject and a latest-state observation, across the token, attestation, anchor and credential rails |
| `anchor.ts` | The generic complete-representation anchor `bsv-attestation-anchor-v1` (`spec/rules.md` §5): build, strict decode and check-by-check inspection |
| `attestation.ts` | Native lifecycle claims `dpp-lifecycle-v1` (`spec/rules.md` §3): validate, sign, verify and digest |
| `blob.ts` | Owner-tier blob hash binding (§7) |
| `canonical.ts` | The canonical bytes an attestation is signed and hashed over: a refusing subset of JCS (`spec/rules.md` §4) |
| `constants.ts`, `types.ts` | The shared vocabulary both of the above are written against |

## Working on it

```
npm run build      # tsc to dist/, which is what the exports map points at
npm run typecheck  # the same compile, emitting nothing
npm test           # the whole suite runs offline
```

The build matters. `main`, `types` and the `exports` map all point into
`dist/`, and nothing aliases the specifier back to `src/`, so a consumer that
has not built this package fails to resolve it rather than falling back to
source. A fresh clone should run `npm run build --workspaces` before anything
that imports `@bsv/dpp-core`.

## The rule that governs it

Within the reference implementation this package is the single place the
standard's rules are coded, and no reference consumer reimplements any of it:
if a consumer needs behaviour that is not here, the change belongs here, with a
test. The normative text is the specification, not this package: `spec/`
defines the rules, `fixtures/` pins the bytes, and an independent
implementation reproduces both without this code. Where this package and the
specification disagree before version 1.0, `GOVERNANCE.md` names the
tiebreaker.
