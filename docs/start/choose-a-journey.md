# Choose a journey

**Audience:** a team deciding how to build a DPP application or service. **Canonical sources:** [`GOVERNANCE.md`](https://github.com/bsv-blockchain/dpp/blob/main/GOVERNANCE.md), [`spec/conformance.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/conformance.md) §6.

Two journeys are supported. They reuse different things and their success proves different things, so the documentation keeps them apart and so should your evidence.

| | Reference package consumer | Independent implementer |
|---|---|---|
| **May reuse** | The four `@bsv/dpp-*` packages, the reference index image, the documented application service interfaces | The specifications, contracts, immutable profile data and fixtures; generic blockchain, cryptography and wallet libraries such as `@bsv/sdk` or a secp256k1 library in another language |
| **Must not reuse** | Nothing is forbidden; the reference is there to be used | `@bsv/dpp-core`, `@bsv/dpp-overlay-topics`, the application service, the Python reader as a runtime oracle, or any mirror of their DPP logic |
| **Success shows** | The packages are consumable outside the repository and compatible services deploy from the reference | Separately implemented DPP rules exchange and verify records with the reference for the declared roles |
| **Does not show** | Anything about the standard beyond its reference implementation | Operational independence, which needs separately operated services, or organisational independence, which needs another implementing party |
| **Start at** | [Use the reference packages](../packages/README.md) | [The implementer contract](../implement/README.md) |

## The line between them

An application that imports the reference DPP validation or writing logic is a reference consumer, however it is deployed, whoever runs it and whatever language its user interface is in. A second user interface over the same service is not a second implementation. Calling the reference through a service as the decision engine is not a second implementation either. Sharing a language with the reference does not disqualify an implementation; choosing another language does not qualify one. What qualifies is that the DPP rules, the bytes and the refusals were written from the specification and held to the fixtures without the reference code on the path, and that the authorship and the shared dependencies are recorded so a reviewer can check.

Some things sit on both sides and are fine to share: `@bsv/sdk` for scripts, keys, signatures, BEEF and merkle paths; a BRC-100 wallet; a JSON Schema validator; an RFC 8785 canonicaliser; the frozen profile manifests and generated schemas, which are data; and every fixture, which is the point of a fixture.

## What each journey is held to

A reference consumer is held to the release set: the package versions, the runtime, the entry points and the compatibility policy of the set it names, and its own tests over the application behaviour it adds. It states which set it consumes and the revision the packages were packed from.

An independent implementer is held to the fixtures and the ledger: every applicable positive and refusal vector for the roles it claims, executed by its own predicates; a capability document naming what it supports; a claim naming its rows; and a record of what it shares with the reference and who wrote it. [Independence and shared dependencies](../implement/independence.md) states the rule in full and [Requirements to assertions](../implement/requirements-matrix.md) lists every row and vector by role.

## What neither journey claims

Consuming the packages or passing the fixtures says nothing about European conformity, product qualification, the truth of any claim, or operational independence. Those are separate claims with separate evidence, and [where things stand](status.md) says which of them are withheld today and why.
