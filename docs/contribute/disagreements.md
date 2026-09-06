# Reporting a disagreement

**Canonical sources:** [`GOVERNANCE.md`](https://github.com/bsv-blockchain/dpp/blob/main/GOVERNANCE.md) (proposing a change, declaring version 1.0), [`fixtures/README.md`](https://github.com/bsv-blockchain/dpp/blob/main/fixtures/README.md).

A disagreement between two implementations is the most valuable thing an independent implementation produces, and the process exists to settle it with a fixture rather than with an argument.

Report it as an issue naming: the vector or the fresh record on which the two implementations differ, with the exact bytes; both outcomes, in each implementation's own words; the clause each reading relies on; and which reading, if either, the fixtures already pin. If no fixture decides it, say so, because that is the finding: an underspecified byte or refusal that the specification must fix and a new vector must pin.

What happens next is governance's: a normative change with the fixture and its refusal vectors in the same request, accepted in writing by every implementing party whose wire shape it touches, or a recorded decision that one implementation has a defect. What does not happen is the independent implementer reading the reference source and adopting whatever it does; that closes the disagreement in the code and leaves it open in the standard, which is the opposite of the point.

An open disagreement between two conforming implementations blocks the version 1.0 declaration by design. A security-relevant one (a non-conforming record that verifies, a forged anchor attributed) is reported privately to the maintainers first.
