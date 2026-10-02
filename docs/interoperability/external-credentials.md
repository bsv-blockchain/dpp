# External credential verification

Select the credential profile before choosing a verifier. The World Wide Web Consortium (W3C) Verifiable Credentials data model and the selected proof suite are separate inputs.

The [verifiable credential guide](../learn/verifiable-credentials.md) explains what a credential carries and which issuance and verification paths exist. [BSV DIDs](../learn/dids.md) explains issuer identity; this external profile specifically selects `did:web`.

## Prepare the verifier inputs

For the selected external representation, retain the credential's exact received bytes and the expected product identifier. Supply the issuer's identity/key documents, the required contexts, observation time and the policy for status and authority checks.

The reference profile uses a Data Integrity proof with the `ecdsa-rdfc-2019` suite and P-256 keys. The main VSC SEAL verifier is a different entry point. Passing a credential to whichever verifier happens to parse JSON is not representation selection.

`verifyExternalCredential` evaluates the credential checks; `externalCredentialVerifierFor` adapts them to the shared passport report. Missing status or authority sources can leave those findings unknown even when the proof itself verifies.

This call verifies the `positive` case of the vector file with the published package, from the repository root after [setup](../quick-start.md#get-the-code). The entry point is `@bsv/vsc/exchange`:

```js
import { readFileSync } from 'node:fs'
import { createExternalDocumentLoader, verifyExternalCredential } from '@bsv/vsc/exchange'

const { vectors } = JSON.parse(readFileSync('fixtures/vectors/dpp/interoperability/external-credential/v1.json', 'utf8'))
const { credential, documents, policy, representation } = vectors.find((v) => v.id === 'positive').input
const retrieved = new Map(Object.entries(documents))

const result = await verifyExternalCredential({
  bytes: new TextEncoder().encode(credential),
  representation,
  policy: {
    documentLoader: createExternalDocumentLoader(retrieved),
    evaluationTime: policy.evaluationTime,
    expectedSubject: policy.expectedSubject,
    authorityPolicy: policy.authority,
    statusPolicy: policy.status && {
      ...policy.status,
      // Throw when a status list cannot be fetched: returning nothing is not the same answer.
      resolve: async (url) => {
        if (!retrieved.has(url)) throw new Error(`status list ${url} is unavailable`)
        return retrieved.get(url)
      },
    },
  },
})
for (const [name, check] of Object.entries(result.checks)) console.log(name, check.outcome)
```

It prints ten checks, from `parse` to `availability`, each `verified`. The vector file names its policy differently from the API: its `authority`, `status` and `subjectBinding` are the call's `authorityPolicy`, `statusPolicy` and `subjectBindingPolicy`, and its `status` carries no `resolve`. Give `statusPolicy` one that throws when a list cannot be fetched, so an unavailable list reads `indeterminate`. Mapped that way, every case in the file gives its expected checks.

## Run the selected cases

After [setup](../quick-start.md#get-the-code), run:

```sh
npm run test -w @bsv/vsc -- test/exchange.test.ts test/exchange-vectors.test.ts
```

The tests use fixture documents and published test keys, including unsupported formats, altered proofs and missing evidence. Expect the selected cases to pass their assertions. This does not contact an issuer's live status service or perform a product assessment.

When connecting an application, retain exact-byte and proof results separately, and show the [per-check report](../learn/evidence-and-freshness.md). Live identity assurance is Ring 0; higher rings are absent.

## Source definitions

| Integration task | Source |
|---|---|
| Select representation and suite | [External credential profile](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/spec/external-credential-profile.md) |
| Supply verification adapters | [Reference exchange API](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/packages/vsc/src/exchange.ts) |
| Interpret the shared report | [Verification source](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/spec/verification.md) |
| Exercise the format | [Credential vectors](https://github.com/bsv-blockchain/dpp/tree/e65498a9570fbb5e859021225875fe7197a06f34/fixtures/vectors/dpp/interoperability) |

Exact received bytes and proof verification remain separate results. A reformatted credential can require a different exact-byte finding even where its proof evaluates the same way. Use [the attestation verifier guide](../implement/roles/attestation-verifier.md) for the surrounding evidence workflow.
