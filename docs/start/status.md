# Where things stand

Working draft. The [ledger](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/conformance/manifest.json) was updated on 2026-09-07. The [release selection](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/conformance/selections/dpp-release-2026-09-3.json) names the claims required for the candidate and those withheld.

| Evidence | Ledger status | What remains |
|---|---|---|
| `GOV-independent-implementation` | implemented | Organisational independence remains an open gate; the Python reader was written by the same programme. |
| `EXPORT-4-complete-export` | tested | Local synthetic evidence; no operator exercise. The registry does not yet serve a complete export. |
| `EXPORT-3-durable-publication` | gap | An independently administered replica and deployment recovery objectives have not been demonstrated. |
| `READY-2-eu-registry` | gap | No Union DPP Registry integration. |

The [independent implementation trial](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/conformance/demonstrations/independent-implementation-2026-09.json) is defined, not completed. Use [conformance review](../reference/conformance.md) to inspect each claim's evidence. Passing the reference tests does not establish product qualification or independent operation.

Live identity assurance is Ring 0. Higher rings are absent. [Ring 0 explained](../learn/identity-and-authority.md).

## Open decisions

| Decision | State and source |
|---|---|
| Repository publication | Public; experimental npm publication is pending. See [release candidate](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/release/dpp-release-2026-09-3.json) |
| Profile repository home | open; see [D-CR5](https://github.com/bsv-blockchain-demos/dpp-app/blob/43e79676341b3a5c12e6cb43f837e7f901c3020b/docs/STATUS.md#L182). |
| Object identifier derivation | open; see [D-CR2](https://github.com/bsv-blockchain-demos/dpp-app/blob/43e79676341b3a5c12e6cb43f837e7f901c3020b/docs/STATUS.md#L181). |
| Historical issuer formats | open; see [TD-12](https://github.com/bsv-blockchain-demos/dpp-app/blob/43e79676341b3a5c12e6cb43f837e7f901c3020b/docs/STATUS.md#L209). |
| Shared deployment | open; see [D-CR7](https://github.com/bsv-blockchain-demos/dpp-app/blob/43e79676341b3a5c12e6cb43f837e7f901c3020b/docs/STATUS.md#L183). |
| Companion profile submission | open; see [D-CG1](https://github.com/bsv-blockchain-demos/dpp-app/blob/43e79676341b3a5c12e6cb43f837e7f901c3020b/docs/STATUS.md#L184). |
| Brand self-custody | open; see [G-28](https://github.com/bsv-blockchain-demos/dpp-app/blob/43e79676341b3a5c12e6cb43f837e7f901c3020b/docs/STATUS.md#L171). |

These decision links require access to the application repository.
