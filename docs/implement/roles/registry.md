# Registry

A registry retains signed claims and evidence so another party can retrieve and evaluate them. It can also expose a validation operation without storing the request. It does not replace the passport history held by an overlay or recover a missing signing key.

## Start with validation

The first interface to implement is `POST /validate`. It accepts a supported secured representation as JSON. For the native exercise, send the signed claim as the body and the independently expected passport identifier in the `subject` query parameter.

Run the [validation request](../../quick-start.md#registry-validation) against that service. The example reads the signed claim from the local fixture, so there is no claim object to transcribe. Expect HTTP 200 and inspect the report's native-signature and subject-binding checks. Missing token or anchor evidence remains unestablished.

The DPP checkout does not start a registry process. A separate reference registry exists, or an independent implementation can supply this endpoint. The [HTTP guide](../../reference/contracts.md#validate-a-claim) explains the request, response and error boundary here.

## Run the separate reference registry locally

With access to the registry repository, use a fresh sibling checkout and Node.js 22 or later:

```sh
git clone https://github.com/bsv-blockchain-demos/uora-bsv.git uora-bsv-local
cd uora-bsv-local
git checkout --detach 07236cf753a238ab7ae3f5dd0c12efe236d6e9f1
npm ci
env -u SERVER_PRIVATE_KEY -u WALLET_STORAGE_URL -u MONGO_URL -u STORE_FILE npm start
```

For this validation exercise, keep the fresh checkout without `.env` or `.env.local` files. The service uses memory storage and has no configured anchoring wallet. It should report that it is listening on port 4000. Leave it running and return to the DPP checkout in a second terminal to run [the validation request](../../quick-start.md#registry-validation). Stop the local process with Ctrl-C afterwards.

The command is defined in the [registry package manifest](https://github.com/bsv-blockchain-demos/uora-bsv/blob/07236cf753a238ab7ae3f5dd0c12efe236d6e9f1/package.json); the [entry point](https://github.com/bsv-blockchain-demos/uora-bsv/blob/07236cf753a238ab7ae3f5dd0c12efe236d6e9f1/src/index.ts) selects storage. A clone or package-access error is a repository/dependency access issue, not a reason to create new signing keys. The independent validation interface above remains usable without this reference service.

## Add storage and retrieval

Once validation works, add intake and exact-byte retrieval. Retain the secured representation and associate its identifier, subject and stored evidence. Test that retrieval returns what was retained before adding history, status or export operations.

Supply optional token history as request context when token checks are needed; it is not a field to add to the signed claim. Do not invent an anchor-script request field. For each supported operation, test malformed input, missing evidence and a valid input as separate cases.

Treat a registry archive as one recovery input. The reference archive does not contain token history, restricted evidence or keys. [Recovery](../../operate/export-import-recovery.md) explains how that affects provider replacement.

## Exact implementation sources

- [contracts/registry.yaml](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/contracts/registry.yaml)
- [spec/services.md](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/services.md)
- [spec/verification.md](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/verification.md)
- [spec/portable-evidence.md](https://github.com/bsv-blockchain/dpp/blob/8691c12c6e81f54216ec30fe4c688f5d1b82b644/spec/portable-evidence.md)

Use [evidence reporting](../reporting.md) for results. [Source gaps](../fixture-runner.md#source-gaps) remain open.

Live identity assurance is Ring 0. Higher rings are absent. [Ring 0 explained](../../learn/identity-and-authority.md).
