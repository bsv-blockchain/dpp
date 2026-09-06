# How the standard changes

**Canonical source:** [`GOVERNANCE.md`](https://github.com/bsv-blockchain/dpp/blob/main/GOVERNANCE.md), which is the process; this page points at it.

Once published, `spec/`, `contracts/` and `fixtures/` are normative; everything else is one way of building what they require. While the draft is pre-1.0 the reference implementation is the tiebreaker, except for a defect the specification names as a defect.

A change starts as an issue describing the gap or the defect (what an implementer cannot do, or what two conforming implementations would disagree about), lands as a pull request against the normative text carrying its rationale where the rule lives, and, if it touches a wire format, updates the fixtures in both forms and adds the refusal vectors the rule implies in the same request. A change that alters what an already-published record means is a new version identifier, never a change.

Editorial changes need one maintainer. Normative changes need one maintainer and, where a wire shape both implementing parties produce is touched, each party's written acceptance recorded in the request. CI must pass, and a red suite is a veto no reviewer can override. Silence is not acceptance.

Version 1.0 is declared when every wire shape has been accepted in writing by every implementing party, at least two independent implementations neither importing the other pass every fixture including every refusal vector, no open issue names a disagreement between conforming implementations, the specification records no known defect in the reference, and the maintainers say so unanimously.

A security problem (a non-conforming record that verifies, a forged anchor attributed, private content reaching the chain) is reported privately to the maintainers first and fixed with a fixture that refuses it; the report and the fix are published together.
