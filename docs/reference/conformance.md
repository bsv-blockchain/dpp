# Conformance and the ledger

**Canonical sources:** [`spec/conformance.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/conformance.md), [`conformance/manifest.json`](https://github.com/bsv-blockchain/dpp/blob/main/conformance/manifest.json), [`conformance/check.mjs`](https://github.com/bsv-blockchain/dpp/blob/main/conformance/check.mjs), [`conformance/qualify.mjs`](https://github.com/bsv-blockchain/dpp/blob/main/conformance/qualify.mjs), [`GOVERNANCE.md`](https://github.com/bsv-blockchain/dpp/blob/main/GOVERNANCE.md).

## Four layers, six roles

Every statement in the normative material belongs to one layer: **core** (encodings, signing, transitions, verification and refusal, where two conforming implementations must reach equivalent findings), **role** (what one role owes), **profile** (a named, versioned selection) or **reference** (how this implementation happens to do it, never a requirement by default). Conformance is claimed role by role for the six roles, and a claim for one says nothing about the others.

## The ledger

`conformance/manifest.json` is the requirement ledger: 83 pinned sources, 160 requirement rows and 24 named claims at the current revision. Every row names its source, version and digest, its clause, layer, roles, applicability and profile, the implementation, test and evidence references that show it met, a status (`unassessed`, `not-applicable`, `gap`, `implemented`, `tested`, `independently-tested`), and who reviewed it when. A source whose digest has moved invalidates every row that cites it until the mapping is reviewed again, which `npm run conformance:pin` records after a review.

## The checker and the gate

`node conformance/check.mjs` is the diagnostic: it validates the ledger, the baselines, the pinned reports, the capability example, every release set and every selection, and reports one sentence per finding. It exits non-zero only for a defect in the material itself; a blocked claim is a finding, because the ledger exists to say so.

`node conformance/qualify.mjs <selection>` is the gate: a selection names the claims a release requires and the claims it withholds with reasons, and the command refuses the selection while any required claim cannot be made, a required not-applicable row lacks its reasoning, an assessment rests on an unavailable source, or a row of a required whole-system scope is neither required nor excluded. Both commands share one assessment module and cannot disagree. The current release set names its selection, and the publication workflow runs the gate before it writes anything.

## What a qualified selection means

That every claim it requires can be made on the ledger's evidence, for the editions and roles the rows cite. It is not a conformity certificate, and it says nothing about product compliance, deployed operation or a third party's testing. Standards conformance, implementation conformance, deployed operation and product-data compliance are separate claims with separate rows.

## The commands

```sh
npm run conformance:check                                                       # the diagnostic
npm run conformance:qualify -- conformance/selections/dpp-release-2026-09-3.json   # the release gate, exit 0 today
npm run conformance:qualify -- conformance/selections/eu-dpp-system-2026-09.json   # the European gate, exit 1 today by design
npm run conformance:independent                                                  # the Python reader over the fixtures
npm run conformance:pin                                                          # re-record digests after a reviewed change
```
