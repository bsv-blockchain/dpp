# External credential verification

Use this page to verify a W3C Verifiable Credential that another party issued about a product, and to fold the result into the passport report. The packages verify this profile, `vc-di-ecdsa-rdfc-2019@1`; they do not issue it, so an issuer needs issuing software of its own.

The profile accepts a VC Data Model 2.0 credential from a `did:web` issuer, with one identified subject and a Data Integrity proof under the `ecdsa-rdfc-2019` suite with a P-256 key. The [verifiable credential guide](../learn/verifiable-credentials.md) explains what a credential carries and which issuance and verification paths exist, and [BSV DIDs](../learn/dids.md) explains issuer identity; this profile selects `did:web`, not the BSV method.

## What you need

- The credential's exact received bytes. The proof is computed over the credential's meaning, not its bytes, so keep the bytes: they are what an anchor commits to.
- The product identifier your caller expects, from your own context.
- The issuer's DID document, retrieved in advance or through a bounded `did:web` resolver you configure, and the JSON-LD contexts the credential uses, pinned in advance: the verifier never fetches a context from a URL the credential names.
- The evaluation time, a status policy with a way to fetch status lists, and an authority policy naming the issuers you trust, or saying explicitly that you require none.

Use the `@bsv/vsc/exchange` entry point. The root `@bsv/vsc` entry verifies SEAL credentials of the Verifiable Supply Chain (VSC) profile, a different representation with different rules. Handing a credential to whichever verifier happens to parse JSON is not representation selection.

## Verify the vector file's credentials

At the root of a checkout, after [setup](../quick-start.md#get-the-code), this verifies the `positive` case of the [credential vectors](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/fixtures/vectors/dpp/interoperability/external-credential/v1.json) and then checks every case against its expected checks. Inside the checkout `@bsv/vsc` resolves to the workspace build; the same code gives the same answers against the published `@bsv/vsc` 0.2.0-beta.3.

```sh
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs'
import { createExternalDocumentLoader, verifyExternalCredential } from '@bsv/vsc/exchange'

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

It prints the ten checks of the `positive` case, from `parse verified` to `availability verified`, then one line for each of the 20 cases, each reading `gives its expected checks`.

The vector file names its policy differently from the call. Its `authority`, `status` and `subjectBinding` are the call's `authorityPolicy`, `statusPolicy` and `subjectBindingPolicy`; `statusOptional` passes through unchanged; and its `status` carries no `resolve`. Give `statusPolicy` a `resolve` that throws when a list cannot be fetched, so an unavailable list reads `indeterminate`. Leave out `statusOptional`, and the line for `status-missing-optional` reads `differs on status`: it gives `indeterminate` where the file expects `not-required`.

`verifyExternalCredential` evaluates the credential's own checks; `externalCredentialVerifierFor` adapts them to the shared passport report, where they answer `externalCredentialProof`, `schema`, `credentialTime`, `credentialStatus`, `issuerAuthority` and `evidenceAvailability`. Missing status or authority sources can leave those findings `unknown` even when the proof verifies.

## Run the example and the tests

```sh
node examples/verify-external-credential.mjs
```

[`examples/verify-external-credential.mjs`](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/examples/verify-external-credential.mjs) prints the ten checks of `positive`, each `Holds`, then `tampered-subject`, whose line `FAILS: proof (proof_failed: ...)` is the expected answer for a credential altered after signing. It ends with the digests of the issued bytes and of a re-serialised copy, which differ while both proofs still verify: only the issued bytes are what an anchor commits to. The command exits 0.

```sh
npm run test -w @bsv/vsc -- test/exchange.test.ts test/exchange-vectors.test.ts
```

It runs 60 tests, all passing, with fixture documents and published test keys, including unsupported formats, altered proofs and missing evidence. Neither command contacts an issuer's live status service or assesses a product.

## Connect an application

Retain the exact bytes and the proof result separately: a reformatted credential can need a different exact-byte finding even where its proof evaluates the same way. Show the [per-check report](../learn/evidence-and-freshness.md), and use [the attestation verifier guide](../implement/roles/attestation-verifier.md) for the surrounding evidence workflow. A resolved DID document establishes a key relationship, not accreditation, and live identity assurance is Ring 0, where the platform vouches only for the account and brand label ([identity and authority](../learn/identity-and-authority.md)).

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
| Supply verification adapters | [Reference exchange API](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/packages/vsc/src/exchange.ts) |
| Interpret the shared report | [Verification source](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/verification.md) |
| Exercise the format | [Credential vectors](https://github.com/bsv-blockchain/dpp/tree/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/fixtures/vectors/dpp/interoperability) |

Next: the [attestation verifier](../implement/roles/attestation-verifier.md), which checks the anchor once a registry has anchored the credential's exact bytes.
