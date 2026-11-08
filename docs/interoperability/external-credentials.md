# External credential verification

Application teams can use this page to verify another party's W3C Verifiable Credential about a product and include the findings in a passport report. The packages verify `vc-di-ecdsa-rdfc-2019@1`; they do not issue it. An issuer needs its own issuing software.

This profile accepts VC Data Model 2.0, a `did:web` issuer, one identified subject and a Data Integrity `ecdsa-rdfc-2019` proof using P-256. See [verifiable credentials](../learn/verifiable-credentials.md) for contents and issuance/verification paths, and [BSV DIDs](../learn/dids.md) for issuer identity. This profile selects `did:web`, not the BSV method.

## What you need

| Input or setup | Source and requirement |
|---|---|
| Example runtime | Node 22 or later; [set up the checkout](../quick-start.md#get-the-code) with `npm ci` and `npm run build`. Run the commands from its root. |
| Package provenance | In the checkout, `@bsv/dpp-credentials` resolves to the workspace build. The same code gives the same answers against candidate version 0.2.0-beta.6. |
| Credential bytes | Keep the exact received bytes from the issuer. A proof covers meaning; an anchor commits to these bytes. |
| Expected product identifier | Your caller's own context. |
| Issuer DID document | Retrieve it in advance or use a bounded `did:web` resolver you configure. |
| JSON-LD contexts | Pin the credential's contexts in advance. The verifier never fetches a context from a URL the credential names. |
| Evaluation and trust policies | Supply the evaluation time, a status policy and status-list fetcher, and an authority policy naming trusted issuers or explicitly requiring none. |

Use `@bsv/dpp-credentials/exchange`. The root `@bsv/dpp-credentials` verifies the parked Verifiable Supply Chain (VSC) SEAL credentials, a different representation with different rules. JSON parsing alone does not select the representation.

## Verify the vector file's credentials

1. Run this to verify `positive` in the [credential vectors](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/fixtures/vectors/dpp/interoperability/external-credential/v1.json), then compare all cases with their expected checks.

```sh
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs'
import { createExternalDocumentLoader, verifyExternalCredential } from '@bsv/dpp-credentials/exchange'

const { vectors } = JSON.parse(readFileSync('fixtures/vectors/dpp/interoperability/external-credential/v1.json', 'utf8'))

// Map one vector's input onto the verifier's call.
function verify({ credential, documents, policy, representation }) {
  const retrieved = new Map(Object.entries(documents))
  return verifyExternalCredential({
    bytes: new TextEncoder().encode(credential),
    representation,
    policy: {
      documentLoader: createExternalDocumentLoader(retrieved),
      evaluationTime: policy.evaluationTime,
      expectedSubject: policy.expectedSubject,
      authorityPolicy: policy.authority,
      subjectBindingPolicy: policy.subjectBinding,
      statusOptional: policy.statusOptional,
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
}

const positive = await verify(vectors.find((v) => v.id === 'positive').input)
for (const [name, check] of Object.entries(positive.checks)) console.log(name, check.outcome)

for (const vector of vectors) {
  const { checks } = await verify(vector.input)
  const differ = Object.keys(vector.expected.checks).filter((name) => checks[name]?.outcome !== vector.expected.checks[name])
  console.log(vector.id, differ.length === 0 ? 'gives its expected checks' : `differs on ${differ.join(', ')}`)
}
JS
```

2. Check the output: ten checks for `positive`, beginning and ending as shown, followed by 20 cases each reading `gives its expected checks`.

```text
parse verified
...
availability verified
```

The vector file and API use different policy names:

| Vector field | API field or rule |
|---|---|
| `authority` | `authorityPolicy` |
| `status` | `statusPolicy`; add `resolve`, which the vector omits |
| `subjectBinding` | `subjectBindingPolicy` |
| `statusOptional` | Pass through unchanged |
| Status fetch failure | `resolve` must throw so an unavailable list reads `indeterminate`. Returning nothing gives a different answer. |
| Omitted `statusOptional` | `status-missing-optional` prints `differs on status`: `indeterminate` instead of the expected `not-required`. |

`verifyExternalCredential` evaluates the credential's own checks; `externalCredentialVerifierFor` adapts them to the shared passport report, where they answer `externalCredentialProof`, `schema`, `credentialTime`, `credentialStatus`, `issuerAuthority` and `evidenceAvailability`. Missing status or authority sources can leave those findings `unknown` even when the proof verifies.

## Run the example and the tests

```sh
node examples/verify-external-credential.mjs
```

[`examples/verify-external-credential.mjs`](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/examples/verify-external-credential.mjs) prints ten `Holds` checks for `positive`, then the intentional refusal for `tampered-subject`:

```text
FAILS: proof (proof_failed: ...)
```

This intentional refusal confirms a post-signing change; the exercise exits 0. It ends with different digests for issued and re-serialised bytes, although both proofs verify. Only the issued bytes are what an anchor commits to.

```sh
npm run test -w @bsv/dpp-credentials -- test/exchange.test.ts test/exchange-vectors.test.ts
```

It runs 60 tests, all passing, with fixture documents and published test keys, including unsupported formats, altered proofs and missing evidence. Neither command contacts an issuer's live status service or assesses a product.

## Connect an application

1. Put the issuer's exact bytes in the report evidence's `externalCredentials`, with their `representation` and `mediaType`.
2. Build the exchange policy from the inputs and mappings above.
3. Pass `externalCredentialVerifierFor(policy)` as the report policy's `credentialVerifier` when calling `verifyPassportEvidence(evidence, expected, reportPolicy)`.

This wiring fragment assumes `evidence`, `expected`, `reportPolicy` and the exchange `policy` are already prepared. The [complete report example](../packages/dpp-protocol.md#what-the-report-takes) supplies the surrounding evidence workflow.

```js
import { verifyPassportEvidence } from '@bsv/dpp-protocol'
import { externalCredentialVerifierFor } from '@bsv/dpp-credentials/exchange'

const report = await verifyPassportEvidence(evidence, expected, {
  ...reportPolicy,
  credentialVerifier: externalCredentialVerifierFor(policy),
})
```

Keep exact bytes and proof results separately: reformatting can change the exact-byte finding without changing the proof result. Show the [per-check report](../learn/evidence-and-freshness.md); follow [the attestation verifier guide](../implement/roles/attestation-verifier.md) for evidence handling. A resolved DID establishes a key relationship, not accreditation. Live assurance is Ring 0: the platform vouches only for account and brand label ([identity and authority](../learn/identity-and-authority.md)).

## If you implement it yourself

The [external credential profile](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/external-credential-profile.md) defines each rule. A verifier in another language needs:

- strict JSON parsing that refuses duplicate keys, malformed UTF-8, excessive nesting and input over 256 KiB;
- contexts pinned to recorded bytes, with the credential's `@context` matched exactly against the pinned sets;
- RDF canonicalisation in safe mode and P-256 ECDSA, for the `ecdsa-rdfc-2019` cryptosuite;
- bounded `did:web` resolution, with the proof's key listed under the document's `assertionMethod`;
- the W3C Bitstring Status List, with the list's own proof verified;
- a JSON Schema check against the profile's structural schema.

## Source definitions

| Integration task | Source |
|---|---|
| Select representation and suite | [External credential profile](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/external-credential-profile.md) |
| Supply verification adapters | [Reference exchange API](https://github.com/bsv-blockchain/dpp/blob/a508eecf467640b5b29a31eb0e0cbc3c8af5617c/packages/dpp-credentials/src/exchange.ts) |
| Interpret the shared report | [Verification source](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/verification.md) |
| Exercise the format | [Credential vectors](https://github.com/bsv-blockchain/dpp/tree/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/fixtures/vectors/dpp/interoperability) |

Next: the [attestation verifier](../implement/roles/attestation-verifier.md), which checks the anchor once a registry has anchored the credential's exact bytes.
