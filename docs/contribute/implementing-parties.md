# Implementing parties

**Canonical sources:** [`GOVERNANCE.md`](https://github.com/bsv-blockchain/dpp/blob/main/GOVERNANCE.md) (roles), [`spec/conformance.md`](https://github.com/bsv-blockchain/dpp/blob/main/spec/conformance.md) §6.

An implementing party runs a conforming implementation against real records. Today there are two: the reference implementation in the standard's repository and the attestation registry maintained by a second party. A wire shape both must produce identically is not settled until both have accepted it in writing.

The independent implementation trial adds a third kind of participant: a team implementing the rules from the specification and fixtures without the reference code. Its evidence is what [the implementer contract](../implement/README.md) describes, and what it establishes depends on who the team is. An implementation written within the programme that maintains the reference is engineering evidence that the specification suffices, and the ledger records it as such; an implementation by another organisation, importing none of the reference code for a property, is what moves a row to `independently-tested` and what the version 1.0 declaration counts. The trial is designed so that the first can become the second without rework: the same bundle, the same matrix, the same report, with a different party on record.

To participate as an implementing party: state the roles you implement and the baseline and profiles you select in a capability document; report against the fixtures one sentence per vector; record authorship and shared dependencies; accept in writing the wire shapes you produce; and raise disagreements through the process rather than around it. The maintainers record acceptance in the pull request that settles each shape.
