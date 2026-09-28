# Where things stand

Working draft. The [ledger](https://github.com/bsv-blockchain/dpp/blob/921a1d36e6a1888ef0d1b08aaf2cf7df54525d81/conformance/manifest.json) was last updated on 2026-09-27. The [release selection](https://github.com/bsv-blockchain/dpp/blob/921a1d36e6a1888ef0d1b08aaf2cf7df54525d81/conformance/selections/dpp-release-2026-09-5.json) names the claims required for the published beta.3 set and those withheld.

| Evidence | Ledger status | What remains |
|---|---|---|
| `GOV-independent-implementation` | implemented | Organisational independence remains an open gate; the Python reader was written by the same programme. |
| `EXPORT-4-complete-export` | tested | The hosted index serves the complete export since 28 September 2026; its interruption, expiry and restore checks are still to be retained. The registry does not yet serve a complete export. |
| `EXPORT-3-durable-publication` | gap | An independently administered replica and deployment recovery objectives have not been demonstrated. |
| `READY-2-eu-registry` | gap | No Union DPP Registry integration. |

The [independent implementation trial](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/conformance/demonstrations/independent-implementation-2026-09.json) is defined, not completed. Use [conformance review](../reference/conformance.md) to inspect each claim's evidence. Passing the reference tests does not establish product qualification or independent operation.

The services the programme hosts, and the release each runs, are listed under [the hosted reference](../deployment.md#the-hosted-reference).

Live identity assurance is Ring 0. Higher rings are absent. [Ring 0 explained](../learn/identity-and-authority.md).

## Open decisions

| Decision | State, and what it means for an implementer |
|---|---|
| Repository publication | Public; the beta.3 packages were published to npm on 27 September 2026. See [published release declaration](https://github.com/bsv-blockchain/dpp/blob/921a1d36e6a1888ef0d1b08aaf2cf7df54525d81/release/dpp-release-2026-09-5.json) |
| Profile governance | Open: who versions a profile and where its canonical definition lives. Until settled, the frozen manifests in `@bsv/dpp-profiles` are the definitions. |
| Object identifier derivation | Declined for now: a physical-object DID stays optional and is never derived from the passport identifier ([identity](https://github.com/bsv-blockchain/dpp/blob/921a1d36e6a1888ef0d1b08aaf2cf7df54525d81/spec/identity.md) section 3). |
| Historical issuer formats | Open: whether the historical anchor's issuer field admits `did:web` as well as `did:key`. Today it admits `did:key` only; new anchors use `bsv-attestation-anchor-v1`, which this does not affect. |
| Hosting of the reference index | Open: where the hosted index runs in the long term. Today it is a standalone container reached by its URL. |
| Companion profile submission | Open: whether to propose the anchoring profile as a formal companion document. No effect on implementations. |
| Brand self-custody | Open: in the reference application the platform controls each brand's identity, so a brand cannot yet update or move it. Nothing in the standard requires this; another application can let brands hold their own. |

