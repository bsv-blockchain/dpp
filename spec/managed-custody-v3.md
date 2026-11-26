# Managed custody evidence exports

**Local proposal for maintainer and implementing-party review. Proposed profile identifier `managed-custody@3`.**

A custodian can prove that a recipient accepted a transfer by producing its signed acceptance. A public reader can identify which acceptance to request from the commitment in the transfer. An operator recovering a passport also needs any acceptance it has signed for a handover still in progress. These uses have different disclosure and verification requirements.

## 1. Selection and compatibility

This proposal inherits [managed custody version 2](managed-custody.md), including its key derivation, offer, transfer, admission and verification rules. Sections 2 to 4 below replace its section 5 carriage paragraph for public evidence and authorised recovery exports. The existing carriage rules continue to govern other disclosure scopes. A deployment declaring support uses the version 3 identifier with the custody options in section 7. Parties must agree on the profile before relying on its export behaviour. An exporter selecting these rules MUST include `managed-custody@3` in the signed package manifest's `profiles` list alongside the other profiles that apply.

The package uses [`dpp-evidence-package@1`](portable-evidence.md#2-the-evidence-package). New acceptances use `dpp-managed-acceptance@2`. A historical acceptance verifies under its own `acceptanceFormat`, including the version 1 signature rule. Historical packages are read under their declared edition and policy. A reader MUST NOT infer the successor profile from the presence or absence of a record. A party that cannot select the required profile reports `not-selected` and stops the operation that depended on it. [Profile selection](conformance.md#4-profiles-and-capabilities).

## 2. Public evidence

A public package declares `disclosure.scope` as `public` and `disclosure.recoveryBackup` as `false`. For each distinct acceptance commitment in a version 2 `TRANSFER` carried for a passport, the exporter MUST identify the record in its own signed manifest. In the following spellings, `<hex>` is the lower-case hexadecimal commitment from field 15.

| What the exporter holds | Required completeness entry |
| --- | --- |
| Holds the signed acceptance and withholds it from public disclosure | `completeness.withheld` contains `acceptance:sha256:<hex> not-public` |
| Lacks the signed acceptance | `completeness.absent` contains `acceptance:sha256:<hex>` |

A commitment receives one disposition per exporter and scope. A custodian MUST retain the records it signs. Declaring a lost record absent discloses the loss and leaves that retention duty outstanding. In a multi-part or bounded export the declarations concern the transfers in that part. In a nested package each signed manifest speaks for its own exporter. An index may therefore declare an acceptance absent while a custodian holding the same record declares it withheld in the enclosing manifest.

The public package MUST omit signed acceptance bodies everywhere, including nested files, reports and copied journals. It MUST omit retained offers, claim codes and commitments disclosed only by a pending offer. An exporter MUST refuse to include a nested package that would disclose this material. A reader can use the commitment to identify the evidence when requesting an authorised package from the custodian. This profile adds no standalone acceptance-record route.

## 3. Authorised recovery

An authorised recovery package declares `disclosure.scope` as `all-tiers` and `disclosure.recoveryBackup` as `true`. For every completed handover in the passport history the exporter supplies, it MUST carry each held, matching signed acceptance once in its own `authority` inventory. The entry uses the record's own `acceptanceFormat` as `representation` and `sha256:<hex>` as `represents`. An acceptance held only with its completed offer is still held. The exporter MUST declare a missing acceptance by commitment in `completeness.absent`. Recovery of that acceptance cannot be claimed.

When the custodian has signed an acceptance and its transfer has yet to complete, it MUST carry the original signed record with its retained offer as recovery data. It MUST keep that record out of the history's `authority` inventory until a completed transfer in the supplied history commits to it. If a send was interrupted, the recovery reader uses its retained journal to establish the outcome. A prepared transaction, index admission or unanswered send alone is insufficient to mark a handover complete. Whether a completed transfer has a confirmed inclusion proof is a separate finding.

Before resuming the offer, the recovery reader MUST verify the acceptance under its recorded signature format and match it to the offer, passport, predecessor, terms and recipient under [the acceptance and transfer rules](managed-custody.md#4-the-transfer). A mismatch MUST prevent use of that record for recovery. A retry MUST use the original signed acceptance, reconcile any previously sent transfer and execute at most one transfer for the request.

## 4. What a history reader reports

The reader supplies acceptance records from the `authority` inventory for the passport history it is verifying. It treats a signed acceptance retained solely with a pending offer as recovery data. The verifier evaluates each referenced or supplied record as follows.

| Evidence supplied to the history verifier | Finding for that reference under `evidenceAvailability` |
| --- | --- |
| A valid acceptance binds to the transfer | `pass` |
| The acceptance is withheld or absent and no matching record is supplied | `unknown` with `referenced-artefact-unavailable` |
| A supplied acceptance fails to bind, including an authority record with no matching transfer in the supplied history | `fail` with `referenced-artefact-mismatch` |

A completeness declaration cannot establish the recipient's acceptance. A package that exposes a signed record in its public files fails the public export rule even if that record verifies. A malformed package can therefore fail an export rule independently of the result of verifying its passport history.

## 5. Acceptance cases for this draft

Start with two completed transfers and a third signed acceptance awaiting transfer. Use distinct request IDs and commitments. Check the following separately.

1. Export public evidence from the custodian holding all three records. The two carried transfers have withheld entries. The pending offer, its commitment and all three signed records are absent from the public bytes. Both completed references have the unavailable finding.
2. Export the same two transfers from an index holding neither acceptance. Its own manifest declares both absent. If the custodian includes that index package in its public export, the index signature and its declarations still verify.
3. Restore an authorised package. The two completed acceptances appear under authority and bind to their transfers. The third acceptance survives with its offer, including its original signature. Resuming twice produces one transfer. A later recovery export carries that acceptance under authority for the completed transfer.
4. Remove a completed acceptance from the passport journal while retaining it in its offer. The authorised package still supplies its authority entry. Remove the last held copy and the package must identify it as absent.
5. Supply the pending acceptance as an authority record for the first two transfers. The history reader reports the mismatch. Substitute a different valid acceptance in the retained offer instead. The recovery reader refuses to resume it.
6. Open a package assembled under the earlier profile, including a public package that contains a signed acceptance. Verify it under its original policy. If an operation explicitly requires version 3, require a package selecting version 3.
