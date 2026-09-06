# Where things stand

**Audience:** anyone deciding whether to build on the standard now. **Release:** `dpp-release-2026-09-3`, a candidate. **Canonical source:** the ledger at [`conformance/manifest.json`](https://github.com/bsv-blockchain/dpp/blob/main/conformance/manifest.json) and the selection at [`conformance/selections/dpp-release-2026-09-3.json`](https://github.com/bsv-blockchain/dpp/blob/main/conformance/selections/dpp-release-2026-09-3.json), read by `node conformance/qualify.mjs`.

The standard is a working draft, pre-1.0. The words below are the ledger's own vocabulary, and each row of the ledger carries exactly one of them: **implemented** means the reference implements it, **tested** means the reference suite exercises it, **independently tested** means an implementation by another implementing party that imports none of the reference code has passed it, **gap** means it is not done, and **withheld** means a release selection names a claim and declines to make it. Nothing here is a score.

## Demonstrated by the reference suite

| What | Evidence |
|---|---|
| Record versions 1 and 2 encode, decode, sign and verify as specified, including every refusal vector | Fixtures `record-v1`, `record-v2`, `chain-v1`, `chain-v2`, `managed-acceptance-v1` and their vector forms; 931 workspace tests at the baseline revision |
| The one verification report is produced identically by the reference reader, the example surface and the pinned cases | `fixtures/evidence-v1.json` (21 cases) and `fixtures/evidence-v2.json` (13 cases) |
| The generic anchor and the historical anchor verify and refuse as specified | `fixtures/attestation-anchor-v1.json`, `fixtures/anchor-v3.json` and their vectors |
| The reference index admits both record versions, serves the capability document, pages history over a snapshot, exports a bounded signed package and a complete resumable export, retracts a refused announcement and synchronises from static peers | The overlay suite, including the 505-state two-part export, restore into a second operator and re-export |
| The four packages install and work from their tarballs in a clean project outside the repository, with their declarations type-checked | `scripts/consumer-check.mjs`, run by CI |
| A second reader in standard-library Python reproduces the pinned bytes of the record, chain, anchor and acceptance fixtures and refuses their refusal vectors | `conformance/independent/python/dpp_verify.py`, run by CI; its narrower coverage of the policy and package vectors is stated in its README |
| The selected claims of the current release set can be made on the ledger's evidence | `node conformance/qualify.mjs conformance/selections/dpp-release-2026-09-3.json` exits 0 |

## Implemented, not yet demonstrated beyond the reference

- The writer's duties (verify before send, announce, broadcast, proof, retain) are implemented in the reference application and exercised by its suites and by the writer example's dry run; writer conformance is self-reported one sentence per rule, because no byte vector can certify behaviour.
- The managed-custody offer, acceptance and transfer lifecycle is implemented in the application service and exercised offline; the reference example builds the same lifecycle from fresh keys.
- The registry's evidence package export covers the claims, credentials, anchors, status and authority it holds; it is a scoped archive, not a recovery backup, and the ledger row for durable publication is a gap.

## Withheld by name

The current release selection withholds these claims, and publishing its packages changes none of them:

| Claim | Why it is withheld |
|---|---|
| Federated operation (`federated-operators@1`) | Two nodes under one administration prove the synchronisation mechanism, never independence. Separately administered operators have not run the acceptance exercises, and durable publication is a gap. |
| Full VSC draft compatibility | The upstream context and executable suite are unavailable at the pinned revision; only the implemented subset is claimed. |
| The UNTP pilot | The UNTP artefacts are not pinned and nothing is validated against them; the profile is proposed. |
| European system conformity | No normative EN text has been read; every EN row is unassessed or a gap. A separate selection, `eu-dpp-system-2026-09`, is the gate, and it is refused today. |
| Compatibility with the draft security and integrity standards | Drafts whose text has not been read. |
| Battery passport qualification | `battery@3` is a draft profile, the Annex XIII mapping is unassessed, and product-data compliance is a separate qualification from any release. |
| Version 1.0 readiness | No implementation by another implementing party has passed every fixture. The Python reader was written within this programme and does not count. |

## What the next milestone has to show

The programme's next milestone is to validate the standard through an independent implementation: a second application whose DPP rules are written from the specification and fixtures, exchanging and verifying records with the reference in both directions, and a passport moved between separately operated providers with the original provider unavailable. [The implementer contract](../implement/README.md) freezes the scope, [the demonstration](../implement/demonstration.md) defines the evidence, and none of it is claimed until it has run. Independent interoperability, operational independence and regulatory conformity are separate claims with separate evidence, and this documentation keeps them apart.
