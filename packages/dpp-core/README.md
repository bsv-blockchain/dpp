# @bsv/dpp-core

The DPP Token Standard v1 reference implementation, and the only place in this
repository the standard is implemented. Everything else imports it: the overlay
topic manager admits outputs by asking this package whether a state is valid,
and consuming applications build and verify every record through it.

Standard v1 is v0 plus the JSON field conventions (`spec/record-model.md` §3,
fields 9 and 10). The 14-field layout and the
chain invariants are untouched from v0, which is why the suite here was ported
rather than rewritten.

## What is in it

`src/index.ts` re-exports the whole surface, so `@bsv/dpp-core` is the only
specifier anything needs:

| Module | What it owns |
|---|---|
| `codec.ts` | The 14-field layout: encode and decode, field encodings per `spec/record-model.md` §3 |
| `signatures.ts` | The canonical signature preimage (§5) |
| `transition.ts` | Which operation may change what, state by state |
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

This package is the single source of truth for the token standard, and none of
it may be reimplemented anywhere else. If a consumer needs behaviour that is
not here, the change belongs here, with a test. The normative text lives beside
it in this repository: `spec/record-model.md` for the record rail, and
`spec/rules.md` for the attestation and anchor rail.
