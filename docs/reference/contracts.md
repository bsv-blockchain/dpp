# Contracts and schemas

Use the service contract for its request, response and error definitions. The report and data schemas are separate interfaces.

## Start with a capability request

The overlay indexes passport and anchor records. The registry validates and retains signed claims. These are separate HTTP services; a route on one does not imply that the other runs at the same address.

After [starting the reference overlay](../operate/README.md), run:

```sh
curl --fail http://localhost:8080/health
curl --fail http://localhost:8080/capabilities
```

Health checks that the service answers. Capabilities describe its interfaces, selected profiles and limits. Compare those with the client operation you intend to run before submitting records or requesting an export.

## Find passport records

This example asks a running overlay for the fixture's passport identifier. Run it from the repository root. Set `INDEX_URL` to use another operator:

```sh
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const fixture = JSON.parse(readFileSync('fixtures/chain-v2.json', 'utf8'))
const passportId = fixture.states[0].data.passportId
const response = await fetch(new URL('/lookup', process.env.INDEX_URL ?? 'http://localhost:8080'), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ service: 'ls_dpp', query: { passportId } }),
})
assert.equal(response.status, 200)
const answer = await response.json()
assert.equal(answer.type, 'output-list')
console.log(JSON.stringify(answer, null, 2))
JS
```

An empty index returns an empty `outputs` array. A populated answer identifies outputs by `outputIndex` and supplies transaction evidence in `beef`. BEEF is Background Evaluation Extended Format. Pass that evidence to the [reader](../implement/roles/passport-reader.md); HTTP 200 does not establish valid history or inclusion. For a live product, replace the fixture identifier with the caller's independently supplied identifier.

## Validate a claim

Send the secured native claim as JSON to `POST /validate?subject=...` on a registry. The query value is the product identifier expected by the caller. The [runnable request](../quick-start.md#registry-validation) reads the claim from the fixture and handles URL encoding.

The current response identifies its contract and contains named checks; a shared `report` is included when a subject can be determined. Inspect that report's checks and limits. A transport success or a registry-level outcome is not a substitute for evidence about each check. Historical representations have a different response contract.

The operation does not store or anchor the claim. Optional `tokenHistory` supplies BEEF-encoded history as request context and is removed before claim verification. A malformed or ambiguous request, including unreadable token history, can return HTTP 400. Connection refusal means the registry is not available at the chosen URL.

## Continue the service workflow

| Operation | Use and next guide |
|---|---|
| Overlay `POST /submit` | Announce transaction evidence for admission. Read the admission response separately from broadcast status; [writer](../implement/roles/passport-writer.md). |
| Overlay `POST /arc-ingest` | Supply later proof evidence; [wallet and proofs](../operate/wallet-broadcast-proofs.md). |
| Overlay `GET /history` | Page through retained history metadata using the returned cursor. Transaction bytes require lookup or export. |
| Overlay `GET /evidence-package` and `GET /evidence-export` | Retrieve retained evidence and its signed inventory; [recovery](../operate/export-import-recovery.md). |
| Overlay `POST /retract` | Withdraw an admitted draft after a refused send; [writer](../implement/roles/passport-writer.md). |
| Registry intake, retrieval and export | Retain secured claims and serve the evidence it actually holds; [registry](../implement/roles/registry.md). |

## Exact contracts and schemas

| Source |
|---|
| [contracts/overlay.yaml](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/contracts/overlay.yaml) |
| [contracts/registry.yaml](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/contracts/registry.yaml) |
| [contracts/interoperability.yaml](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/contracts/interoperability.yaml) |
| [contracts/verification-report.schema.json](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/contracts/verification-report.schema.json) |
| [contracts/capabilities.schema.json](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/contracts/capabilities.schema.json) |
| [contracts/publisher-policy.schema.json](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/contracts/publisher-policy.schema.json) |
| [contracts/paginated-history.schema.json](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/contracts/paginated-history.schema.json) |
| [contracts/evidence-package.schema.json](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/contracts/evidence-package.schema.json) |
| [contracts/evidence-export.schema.json](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/contracts/evidence-export.schema.json) |
| [contracts/native-evidence-extension.schema.json](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/contracts/native-evidence-extension.schema.json) |
| [contracts/epcis-import.schema.json](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/contracts/epcis-import.schema.json) |
| [contracts/passport-source.schema.json](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/contracts/passport-source.schema.json) |
| [contracts/passport-projection.schema.json](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/contracts/passport-projection.schema.json) |
| [contracts/profile-evidence.schema.json](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/contracts/profile-evidence.schema.json) |
| [release/release-set.schema.json](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/release/release-set.schema.json) |
| [conformance/manifest.schema.json](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/conformance/manifest.schema.json) |
| [conformance/baseline.schema.json](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/conformance/baseline.schema.json) |
| [conformance/selection.schema.json](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/conformance/selection.schema.json) |
| [packages/dpp-profiles/schemas](https://github.com/bsv-blockchain/dpp/tree/8691c12c6e81f54216ec30fe4c688f5d1b82b644/packages/dpp-profiles/schemas) |

For implementation workflow, see [registry](../implement/roles/registry.md), [overlay](../implement/roles/overlay.md) and [interoperability](../interoperability/README.md). [Native validation](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/contracts/registry.yaml#L781-L831) defines the request-context option and supplied token history.
