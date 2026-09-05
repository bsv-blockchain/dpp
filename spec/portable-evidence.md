# Portable evidence: complete pages and packages that survive their operator

**Status: working draft, pre-1.0.** This document defines how a reader retrieves a complete history from a service in pages that do not lie about completeness, and how the evidence for a passport travels as a signed package that another operator, or a reader with no operator at all, can verify. The property it serves is [`services.md`](services.md) §1: no service is load-bearing, so what a service holds must be exportable, complete relative to a stated scope, and verifiable from bytes and headers once it has left.

## 1. Pages of a snapshot

A bounded query that returns the newest five hundred records and stops is a lookup, not an export. An export answers in pages over a stable snapshot, and each page says what it is.

| Property | Requirement |
|---|---|
| `items` | The page's records, in the snapshot's order. |
| `nextCursor` | An opaque cursor for the next page, or `null` when the snapshot is exhausted. |
| `snapshotId` | The identifier of the snapshot every page of this export is read from. |
| `scope` | What was queried, in words and identifiers: the topics or services, the passport or issuer selectors, the source's own sequence range. |
| `truncated` | `true` when the page was cut short by a limit, `false` otherwise. |
| `completeForSnapshot` | `true` only on the last page and only when every record in the snapshot's scope has been returned; never on an earlier page, and never a statement about records outside the snapshot. |

Ordering is by the source's own sequence, then by transaction and output identity, so two readers of one snapshot receive the same pages. Cursors are opaque, bound to the query and the snapshot, and refused with a named error when tampered with or expired; an expired snapshot answers a named restart, never a silent continuation from the middle. The default page holds 100 items and the maximum 500, and there is no hidden cap on the total. Completeness is relative to the snapshot's scope: an export can be complete for what one source held and still miss what another source holds, and a reader checks token predecessor continuity and reports missing evidence independently of page completion. The existing bounded lookups remain readable for what they are, documented as bounded, and are not used as exports.

## 2. The evidence package

`dpp-evidence-package@1` is a directory or archive of content-addressed files under a signed manifest conforming to [`../contracts/evidence-package.schema.json`](../contracts/evidence-package.schema.json).

The manifest names the format and version, the exact passport identifier, genesis outpoint and selected tip, the export time, the profile and policy references under which the package was assembled, the source observations it rests on (which services were asked, when, and what they said about the latest state), the disclosure scope (public only, or which restricted tiers are included and for whom), the completeness declarations (complete for which source snapshots, and what is known to be absent or withheld), and an inventory of every file: its path, media type, byte length and SHA-256, in one of the categories below.

| Category | What it holds |
|---|---|
| `transactions` | Raw transactions of the token history, and of anchors. |
| `proofs` | BEEF and BUMP material: merkle paths and the ancestors a verifier needs. |
| `native-claims` | Signed native lifecycle claims, as posted. |
| `external-credentials` | Original secured credentials in their exact bytes, with their representation and media type. |
| `evidence` | Evidence files the claims reference, encrypted where restricted. |
| `schemas` | The schemas and contexts the credentials were validated against, pinned. |
| `authority` | Historical publisher and authority records: which keys were authorised when, under which policy. |
| `status` | The status observations made at export, with their retrieval times and the documents read. |
| `reports` | Verification reports produced at export, in the shape [`verification.md`](verification.md) defines. |

Paths are relative, contain no traversal and no duplicates, and decompression of any archive form is bounded. The manifest signature is ECDSA over the SHA-256 of the manifest's canonical JSON without the signature value (object keys sorted recursively, no whitespace, arrays in order, only strings, booleans and safe integers as values). It authenticates the exporter and the inventory: that this exporter assembled these bytes. It does not prove that the inventory is exhaustive or that any included claim is true; a reader verifies every digest, every transaction, every proof and every claim independently of who signed the package. Absent or restricted material is declared, never implied present. A package assembled under a public disclosure scope is not a recovery backup and says so. Credentials and secrets that authorise spending are never part of an evidence package; custody recovery has its own governed process.

## 3. Replicas, recovery and restricted evidence

An operator that claims durable publication keeps an independently administered replica of the required evidence. The reference deployment proposes a recovery point objective of zero for evidence it has acknowledged as immutable and a recovery time objective of twenty-four hours, to be demonstrated with the chosen storage systems and stated as service objectives, not as regulatory periods; retention duration comes from the applicable industry or legal profile. While replication of a record is pending, the operator distinguishes blockchain acceptance from completed durable publication rather than claiming both.

Restricted evidence is encrypted at rest and in every package that carries it, and authorised access is tested after an operator migration, including key rotation, recovery, the withdrawal of a former recipient's access and the loss of the original account provider. Public digest checks continue when restricted content is unavailable: a digest cannot restore missing bytes, and deleting a stored row cannot erase metadata already published on chain.

## 4. Normative and implementation

What a conforming party reproduces: the page properties and their meanings, the snapshot ordering and the cursor and expiry rules (§1); the package manifest, its inventory categories, the digest-first import and the declarations of absence (§2); and the separation of blockchain acceptance from durable publication (§3). What is a build's own: the storage behind a snapshot, the archive form, where a replica runs, and how a deployment meets the objectives it declares.
