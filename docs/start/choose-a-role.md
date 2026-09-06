# Choose a role

**Audience:** an implementer deciding what to build. **Canonical source:** [`spec/conformance.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/conformance.md) §2 and the role tables of [`conformance/baseline-native-2.json`](https://github.com/bsv-blockchain/dpp/blob/main/conformance/baseline-native-2.json).

The standard is claimed role by role. Each role has a bounded contract, prerequisites, a smallest implementation path and test targets, and the ledger names the requirement rows that bind it. Pick the roles you fill; leave the rest to someone else, and say so in your capability document.

| Role | Responsibility | Prerequisites | Smallest path | Guide |
|---|---|---|---|---|
| **Passport reader** | Decode and verify supplied token history of either record version and report the scope of the finding | Transaction bytes; a header source, or the explicit decision to skip inclusion | The fixtures alone: no account, no wallet, no service | [Reader](../implement/roles/passport-reader.md) |
| **Attestation verifier** | Verify claim signatures, anchor attribution, digest and metadata binding, and the selected authority and status evidence, reporting what could not be checked | Claim and anchor bytes; a policy naming the trust inputs | The anchor fixture and the anchor cases of the report fixture | [Verifier](../implement/roles/attestation-verifier.md) |
| **Passport writer** | Construct valid states and discharge the announcement, broadcast, proof and retention duties | A BRC-100 wallet with funds or a co-funding publisher; the selected service adapters | One wallet under possession, dry run first | [Writer](../implement/roles/passport-writer.md) |
| **Attestation issuer** | Sign attributable lifecycle claims under the declared format and profile | The signing capability the format requires; retained evidence; never a token spend | Sign the anchor fixture's claim | [Issuer](../implement/roles/attestation-issuer.md) |
| **Registry** | Apply declared intake and status policies; retain and return exact secured bytes and scoped reports | The registry contract; the anchoring and issuer roles declared separately where performed | The contract suite and the shared anchor fixture | [Registry](../implement/roles/registry.md) |
| **Overlay** | Admit and serve evidence under published policy, including the selected synchronisation profile | The overlay contract; no requirement to provide an application | Serve the contract as the reference does | [Overlay](../implement/roles/overlay.md) |

## Which roles come first

For the independent implementation trial the order is fixed by what each role's evidence means. Start with the **passport reader** and the **attestation verifier** under `native-baseline@2`: they are exercised entirely by fixtures, need no funds and no service, and every refusal vector is a predicate you can run tonight. Then the **passport writer** and the **attestation issuer**, so that records flow in both directions between your implementation and the reference. The **registry** and **overlay** roles are service roles; implementing them independently is what makes a second *provider* rather than a second *reader*, and provider independence is a claim about separately operated services with their own keys, databases and policy, never about a library.

## What the baseline gives you

`native-baseline@2` is one complete recommended selection: the exact wire versions, the four BRC-42 derivations, the representations and media types, the refused and historical formats, the reason-code vocabulary and the fixtures with their digests, plus the requirement ids each role must satisfy. A component claiming a role under the baseline implements that role's mandatory rows as listed and need implement no other role and no industry, exchange or operator profile. `native-baseline@1` remains for a component that reads version 1 alone; neither supersedes the other until a version 1.0 declaration says so.

## What every role reports

One sentence per check, never a score. A reader that lacks a header source reports inclusion **unknown**, not pass. A verifier without an authority policy reports authority **unknown** with the reason that says why. A capability document says what the component supports and what it explicitly does not, and it is a claim of support, checkable against the ledger, never proof of conformance.
