# Where things stand

The standard is a working draft before version 1.0. Its beta.7 packages, under the Apache 2.0 licence, were published to npm under the `latest` tag on 2 October 2026, the beta.8 overlay package followed the same day, the beta.9 overlay package followed on 3 October 2026, and you can build readers, writers, an index and a registry with them today. This page says what works, what does not yet, and which decisions are still open.

## Works today

- **Read and verify any passport** from an index's lookup, with a report of sixteen checks: record encoding, both signatures, linkage, inclusion, subject binding, claims, anchors and evidence ([quick start](../quick-start.md#read-a-live-passport)).
- **Write passports** of record version 1 or 2 with a BRC-100 wallet, announce them to an index before sending, and push their proofs ([build an application](../packages/build-an-application.md)).
- **Run an index** from the packages with Docker: lookups, history, evidence packages and complete exports, proof ingestion, and synchronisation with the peers you name ([run a service](../operate/README.md)).
- **Sign, anchor and validate claims** about a passport, kept apart from the passport itself ([passport states and attestations](../learn/passport-and-attestations.md)).
- **Carry product data** under the current `general@2`, `battery@2` and `textile@2` profiles, with version 4 drafts to evaluate ([profiles](../profiles/README.md)).
- **Connect other standards**: GS1 Digital Link identifiers and discovery, EPCIS 2.0.1 event import, selected W3C credential formats and passport projections ([interoperability](../interoperability/README.md)).
- **Try it hosted**: the [demonstration and hosted services](../deployment.md#the-hosted-reference).

## Not working or not settled yet

[Known limitations and open questions](../operate/limitations.md) lists every gap, with what it means for you and what to do now. The ones most newcomers meet first:

- nothing tells a reader which index or registry holds a publisher's records;
- a later proof does not follow synchronisation;
- the report does not check a payload against its profile;
- identity assurance is Ring 0: nobody checks a brand's legal identity.

## Conformance evidence

The ledger records, for every requirement of the standard, how far it is implemented and what evidence supports it; a release's selection names the conformance claims that release makes and the ones it withholds. Claims here are claims about the standard, not the lifecycle claims a passport carries. Read the [ledger](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/manifest.json) beside the [release selection](https://github.com/bsv-blockchain/dpp/blob/f9d8e98658c7cf406702d49194ec5a8480cbca73/conformance/selections/dpp-release-2026-10.json), which names the claims required for the published beta.4 set and those withheld.

| Evidence | Ledger status | What remains |
|---|---|---|
| `GOV-independent-implementation` | implemented | Organisational independence remains an open gate; the Python reader was written by the same programme. |
| `EXPORT-4-complete-export` | tested | The hosted index serves the complete export since 28 September 2026; its interruption, expiry and restore checks are still to be retained. The registry does not yet serve a complete export. |
| `EXPORT-3-durable-publication` | gap | An independently administered replica and deployment recovery objectives have not been demonstrated. |
| `READY-2-eu-registry` | gap | No Union DPP Registry integration. |

The [independent implementation trial](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/demonstrations/independent-implementation-2026-09.json) is defined, not completed. Use [conformance review](../reference/conformance.md) to inspect each claim's evidence. Passing the reference tests does not establish product qualification or independent operation.

## Open decisions

| Decision | State, and what it means for an implementer |
|---|---|
| Profile governance | Open: who versions a profile and where its canonical definition lives. Until settled, the frozen manifests in `@bsv/dpp-profiles` are the definitions. |
| Object identifier derivation | Declined for now: a physical-object DID stays optional and is never derived from the passport identifier ([identity](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/identity.md) section 3). |
| Issuer formats of the older anchor | Open: whether the issuer field of the historical `uora-anchor-v3` anchor admits `did:web` as well as `did:key`. Today it admits `did:key` only; new anchors use `bsv-attestation-anchor-v1`, which this does not affect. |
| Hosting of the reference index | Open: where the hosted index runs in the long term. Today it is a standalone container reached by its URL. |
| Companion profile submission | Open: whether to propose the anchoring profile as a formal companion document. No effect on implementations. |
| Brand self-custody | Open: in the reference application the platform controls each brand's identity, so a brand cannot yet update or move it. Nothing in the standard requires this; another application can let brands hold their own. |
