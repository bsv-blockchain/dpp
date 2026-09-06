# Registry

**Audience:** an implementer of a registry service. **Baseline:** `native-baseline@2`. **Prerequisites:** the registry contract; the anchoring and issuer roles declared separately where the registry performs them. **Network:** the registry is a service; its anchoring, if any, needs a wallet. **Canonical sources:** [`spec/services.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/services.md) §3 to §6, [`contracts/registry.yaml`](https://github.com/bsv-blockchain/dpp/blob/main/contracts/registry.yaml) 0.2.0, [`spec/verification.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/verification.md), [`spec/portable-evidence.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/portable-evidence.md), [`spec/exchange.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/exchange.md).

## Inputs and outputs

| Input | Output |
|---|---|
| Submissions naming their representation explicitly: a native claim, a VSC envelope with the exact credential string, or an external credential; the operator's verification policy; status list sources; token history when a caller supplies it to `POST /validate` | Stored exact bytes with representation, media type, digest and the scoped report; the report for a stored record; history and chain pages over a snapshot; the evidence package; the capability document naming what the registry supports and what it does not |

## What you reproduce

1. **Explicit representation selection**: every submission names its representation, an unsupported one is refused with a named outcome, and nothing falls through to a legacy path.
2. **Exact bytes**: store the complete original bytes, media type, representation and digest; a corrected or projected credential is a new record that retains its source relationships.
3. **The report**: for the same evidence and policy, the same `spec/verification.md` report the reference produces, which the report fixtures pin case by case; the expected subject from the request context and never from the evidence.
4. **Status**: authenticated, purpose-aware, bounded retrieval held to a named freshness profile; an unauthenticated list or a self-asserted authority never satisfies active validation.
5. **Claim relations**: `supersedes`, `revokes`, `suspends`, `expires` and `disputes` as relations between attestations, none implied by a token spend; conflicts resolved authority-first within one comparable trust framework and otherwise returned unresolved.
6. **Pages and packages**: history and chain pages over a stable snapshot with opaque cursors; the evidence package as a signed manifest over content-addressed files with absence declared, never implied.
7. **The contract, machine-checked**: every documented operation served, every served route documented or listed as an intentional omission with a reason.

## The minimal runnable path

Serve `POST /validate` for a native claim from `fixtures/attestation-anchor-v1.json` with its anchor script supplied, and compare the report with the corresponding case of `fixtures/evidence-v1.json`. Store the claim through `POST /attestations`, read it back byte for byte, and produce the same report from the stored record. Submit the same bytes again and answer 409. Submit a credential in a representation you do not support and answer a named refusal. Export the passport's evidence package and inspect it against `contracts/evidence-package.schema.json` and the evidence package vectors (1 positive, 7 refusals).

## Expected results

Identical reports to the pinned cases; exact-byte round trip; named refusals; a package whose manifest signature, inventory and structure verdicts each hold.

## Scope of the reference registry's archive

The reference registry's evidence package covers what a registry holds: native claims, external credentials, retained anchor scripts and transactions, status observations, authority records and reports. It is a scoped archive under a public disclosure scope and not a recovery backup: it carries no token history (that is the index's export), no restricted evidence and no key. A provider migration that needs the registry's material and the index's material assembles both, and the ledger row for durable publication remains a gap until an independently administered replica has been demonstrated.
