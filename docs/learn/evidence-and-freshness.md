# Evidence and its limits

A signature attributes bytes. An inclusion proof connects a transaction to a block. A latest-state observation describes what the queried sources returned. A complete export covers a declared source and snapshot. None supplies missing evidence for the other questions.

## Read a verification result

Start with the individual entries in `checks`. Each names the question evaluated and carries a `status`; `reasonCode` explains an incomplete or unsuccessful check. `evidenceRefs` identifies the material used. Read `observations` for what queried services said about the latest state, and `limits` for what the report leaves unestablished.

| Status | How to read it |
|---|---|
| `pass` | The check ran on the evidence and held. |
| `fail` | The check ran and did not hold. |
| `unknown` | The evidence, source or policy needed to complete the check was missing or unavailable. |
| `not-applicable` | The selected profile or policy defines that check as not applying. Missing evidence alone is not this case. |

A synthetic history can have passing signatures and linkage while inclusion remains unknown. An older, valid prefix can still have a later state. A claim can have a valid issuer signature while issuer authority remains unknown. Keep these distinctions in both human output and machine decisions.

## Inspect a stored report

From the repository root, this command prints one expected report from the fixture. It illustrates the output structure; it does not execute verification:

```sh
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs'
const fixture = JSON.parse(readFileSync('fixtures/evidence-v2.json', 'utf8'))
const { report } = fixture.cases[0]
console.table(report.checks.map(({ name, status, reasonCode }) => ({ name, status, reasonCode })))
console.log(report.observations)
console.log(report.limits)
JS
```

Run the [reader quick start](../quick-start.md#reader-and-verifier) to reproduce those fixture reports through the implementation. For an application decision, name the checks required by its policy and retain their findings. A single success label would hide the missing checks.

## Source definitions

| Reader task | Source |
|---|---|
| Interpret each check and its reason | [Verification report](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/verification.md), [report schema](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/contracts/verification-report.schema.json) |
| Evaluate supplied passport history | [Record verification](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/record-model.md) |
| Evaluate claims and commitments | [Attestation verification](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/rules.md) |
| Inspect an export's coverage | [Portable evidence](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/portable-evidence.md), [complete export](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/exchange.md) |

Missing evidence stays visible in the report. A verified historical prefix can still omit a later state. A service's answer is evidence from that service, not a view of every provider.

Live identity assurance is Ring 0. Higher rings are absent. [Ring 0 explained](identity-and-authority.md).

Use [the reader exercise](../implement/roles/passport-reader.md) to produce a report and [recovery](../operate/export-import-recovery.md) to inspect an export.
