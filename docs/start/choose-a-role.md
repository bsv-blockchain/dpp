# Choose a role

A role is one component of a passport system, such as the reader that checks a passport or the index that finds one. Find the component you are building, then follow the column for how you are building it: with the published packages, or in your own code.

| Role | What it does | With the packages | In your own code |
|---|---|---|---|
| Passport reader | Checks a passport's history | [Build an application](../packages/build-an-application.md#1-read-a-passport), step 1 | [Passport reader](../implement/roles/passport-reader.md) |
| Attestation verifier | Checks a signed claim and its anchor | [Gather a passport's evidence](../packages/dpp-core.md#gather-a-passports-evidence) | [Attestation verifier](../implement/roles/attestation-verifier.md) |
| Passport writer | Writes each new state of a passport | [Build an application](../packages/build-an-application.md#3-write-a-passport), step 3 | [Passport writer](../implement/roles/passport-writer.md) |
| Attestation issuer | Signs a claim about a product, such as a repair | [Build an application](../packages/build-an-application.md#4-sign-and-anchor-a-lifecycle-claim), step 4 | [Attestation issuer](../implement/roles/attestation-issuer.md) |
| Registry | Validates and stores signed claims | No registry package is published; build one against the contract with the packages' calls ([registry](../implement/roles/registry.md)) | [Registry](../implement/roles/registry.md) |
| Index (the overlay role) | Admits passport states and answers lookups | Build and run it with Docker Compose from a checkout ([run a service](../operate/README.md)), or embed [`@bsv/dpp-overlay-topics`](../packages/dpp-overlay-topics.md) | [Overlay](../implement/roles/overlay.md) |

One program can fill several roles, and each is claimed separately. Start with the reader whichever route you take: every other role checks what it makes or receives with the reader's rules.

Writing your own code? [Start an independent implementation](../implement/README.md#pick-your-role) gives the build order, what you may reuse and the fixtures for each role. The [role definitions](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/conformance.md) (section 2) and the [baseline](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/baseline-native-2.json) hold each role's obligations and tests.
