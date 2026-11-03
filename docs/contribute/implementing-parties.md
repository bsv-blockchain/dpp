# Implementing parties

Organisations building their own implementation can use this page to join the interoperability trial or request an exchange with the hosted reference. Follow the steps from a first build to a recorded exchange, and prepare the contact information below.

| Governance fact | Meaning or current evidence |
|---|---|
| Implementing party | Runs a conforming implementation against real records, as [GOVERNANCE.md](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/GOVERNANCE.md#roles) defines. |
| Normative wire changes | A change to a wire shape both parties produce needs each one's written acceptance. |
| Version 1.0 | Needs at least two independent implementations, neither importing the other, that pass every fixture. |
| Parties counted today | GOVERNANCE.md counts this repository's reference implementation and the attestation registry. Neither is an independent implementation. |
| Independence evidence | The [ledger](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/manifest.json) keeps the independent-implementation gate open. No other organisation's implementation has been recorded as passing every fixture. |

Taking part, writing independent code and operating services under separate administration are different facts. Record which you have shown; participation alone does not establish a tested implementation.

## Before joining an exchange

| Stage | Required input and source |
|---|---|
| Contact readiness | Your components can explain their own results, and you want to join the trial or exchange records with the hosted reference. |
| Evidence to retain | Your fixture harness results, code authorship, dependencies and the revision, requirement, input digest and command for each result. |
| Record exchange | Your index's public base URL, publisher key and oldest signed state's time. Include your operator identity key and signed policy chain if you want the reference to check them. |
| Hosted scenarios | Programme participation and the scenario-specific records or access below. Public material alone does not supply these. |

## Steps

1. **Choose roles and versions:** reader, verifier, writer, issuer, index or registry; then record, profile and contract versions. Start at the [implementer start](../implement/README.md).
2. **Pass the fixtures.** Build a harness producing one result per case, including refusals ([run the fixtures](../implement/fixture-runner.md)). Record authorship and dependencies.
3. **Keep the evidence** with each requirement, input digest, revision and command ([requirements and evidence reporting](../implement/reporting.md)). A useful first contribution is a reproducible difference: the input both implementations read, their results and each reading's rule ([report a disagreement](disagreements.md)).
4. **Contact the programme** through the [BSV Association contact form](https://bsvassociation.org/contact/) when ready. Fill in the submission below; [peering guidance](../operate/federation.md#peer-with-the-hosted-reference-or-another-operator) explains exchange details.
5. **Run the exchange** with the other participant ([run the interoperability trial](../implement/demonstration.md)). Keep requests, exact artefacts and per-check reports.

### Prepare the contact information

```text
Organisation and contact:
Roles, versions and release set:
Implementation revision:
Fixture results or their location:
For a record exchange, index public base URL:
For a record exchange, publisher key and time of the oldest state it signed:
For a record exchange, if the reference should check them, operator identity key and signed policy chain:
Trial scenarios requested:
```

## What needs the programme

Only the programme can write to the hosted reference. These scenarios therefore need its participation:

| Scenario | Required access or records | Evidence to retain |
|---|---|---|
| `exchange-reference-writes` | Fresh version 2 records and claims written by the reference for you to read and verify. | Requests, exact artefacts and per-check reports. |
| `exchange-independent-writes` | Admission of your records: the reference index operator names your publisher key, then gives you a submit token or pulls from your index. Each state's proof must reach the reference's `POST /arc-ingest`, which needs its callback token. | Requests, exact artefacts and per-check reports. |

The other scenarios in the [trial definition](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/conformance/demonstrations/independent-implementation-2026-09.json) can be rehearsed with your own services. Report successful local rehearsal as preparation.

## What you get back

The programme decides whether and when to join an exchange. Report results and disagreements through the [issue tracker](https://github.com/bsv-blockchain/dpp/issues); send sensitive material privately as [report a disagreement](disagreements.md) describes.

Record exchange evidence against the trial definition. Programme-produced runs are engineering evidence; organisational independence is recorded only when another implementing party runs the same scenarios.

Next: [implementer start](../implement/README.md), or [how the standard changes](README.md) to turn a disagreement into a change.
