# Implementing parties

This page is for an organisation that wants to take part in the standard with an implementation of its own: building it, joining the interoperability trial, or exchanging records with the hosted reference. It says what an implementing party is, the steps from a first build to a recorded exchange, and what to send the programme.

An implementing party, in [GOVERNANCE.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/GOVERNANCE.md#roles), is one that runs a conforming implementation against real records. Implementing parties matter for two rules: a normative change to a wire shape both of them produce needs each one's written acceptance, and version 1.0 needs at least two independent implementations, neither importing the other, that pass every fixture. GOVERNANCE.md counts two implementing parties today, this repository's reference implementation and the attestation registry, but neither is an independent implementation: the [ledger](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/manifest.json) keeps the independent-implementation gate open, and no other organisation's implementation has yet been recorded as passing every fixture.

Taking part, writing independent code and operating services under a separate administration are three different facts. Record which of them you have actually shown; taking part alone does not establish a tested implementation.

## Steps

1. **Choose your roles and versions.** Pick the roles you implement (reader, verifier, writer, issuer, index, registry) and the record, profile and contract versions, starting from the [implementer start](../implement/README.md).
2. **Pass the fixtures.** Build a fixture harness and produce one result per case, refusals included, as [run the fixtures](../implement/fixture-runner.md) describes. Keep a record of the code's authorship and its dependencies.
3. **Keep the evidence.** Retain each result with its requirement, input digest, revision and command, as [requirements and evidence reporting](../implement/reporting.md) describes. The first useful contribution is often a reproducible difference: an input both implementations read, the results they produced and the rule behind each reading, reported as [report a disagreement](disagreements.md) describes.
4. **Contact the programme**, when your components can explain their own results and you want to join the trial or exchange records with the hosted reference. Use the [BSV Association contact form](https://bsvassociation.org/contact/) and send:
   - your organisation and a contact;
   - the roles, versions and release set you implement, and your implementation's revision;
   - your fixture results, or where to read them;
   - for an exchange of records: your index's public base URL, your publisher key and the time of the oldest state it signed, and, if you want the reference to check them, your operator identity key and signed policy chain ([peer with the hosted reference](../operate/federation.md#peer-with-the-hosted-reference-or-another-operator));
   - which trial scenarios you want to run.
5. **Run the exchange** with the other participant, as [run the interoperability trial](../implement/demonstration.md) describes, keeping the requests, exact artefacts and per-check reports.

## What needs the programme

Two kinds of trial scenario cannot be run from the public material alone, because only the programme can write to the hosted reference:

- `exchange-reference-writes` needs fresh version 2 records and claims that the reference writes for you to read and verify.
- `exchange-independent-writes` needs the reference index to admit the records you write: its operator names your publisher key and either gives you a submit token or pulls from your index, and a proof for each state has to reach the reference's `POST /arc-ingest`, which needs its callback token.

The other scenarios in the [trial definition](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/demonstrations/independent-implementation-2026-09.json) can be rehearsed with services you run yourself. A successful local rehearsal is useful preparation and is reported as that.

## What you get back

The programme decides whether and when to take part in an exchange. Results and disagreements found along the way are reported through the [issue tracker](https://github.com/bsv-blockchain/dpp/issues) or, for anything sensitive, privately as [report a disagreement](disagreements.md) describes. Evidence from an exchange is recorded against the trial definition, which treats runs produced by the programme itself as engineering evidence; organisational independence is recorded only when another implementing party runs the same scenarios.

Next: start with the [implementer start](../implement/README.md), or read [how the standard changes](README.md) for how a disagreement you find becomes a change.
