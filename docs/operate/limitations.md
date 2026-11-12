# Known limitations and open questions

Developers, operators and product teams can use these limits to decide whether a planned operation can proceed. Check them before starting, or when evidence does not arrive or a check reads `unknown`. Other guides link here for shared limits.

## Identify the version and deployment

| Input | Source and scope |
|---|---|
| Installed release | Your package selection. The last published set is `dpp-release-2026-10-10`, including `@bsv/dpp-overlay@0.4.0-beta.12`. |
| Source candidate | Your checkout. `dpp-release-2026-11` supersedes the published set for development; it is not yet published. Candidate-only features are labelled below. |
| Hosted version | The [hosted reference](../deployment.md)'s capability document. Source changes do not upgrade that deployment. |

Limits apply to both releases unless a row names a version. [Resolved questions](#resolved-in-the-november-candidate) remain separate from open ones.

## Writing

| Limit | Effect | Action |
|---|---|---|
| Only a refused passport state says why | `X-Admission-Refusal` names the failed `tm_dpp` check. A refused `tm_attestation` anchor, or any refusal on an earlier index, answers `none`; only the operator's log gives the reason. | Before announcing an anchor, check that `GET /capabilities` accepts its anchoring service. For older indexes, check the [refusal causes](../packages/build-an-application.md#when-the-index-refuses-a-state) and request the log line. |
| Capability publisher keys lack windows and signatures | `GET /capabilities` is the index's word. It may refuse a listed key outside its timestamp window. | Check `GET /publisher-policy`'s signed chain against the operator's identity key ([tell operators apart](federation.md#tell-operators-apart)). Earlier indexes serve it only in evidence packages. |
| Hosted services use mainnet | Every hosted write, including a signed-in demonstration brand's write, costs satoshis. Sample brands write nothing to the chain. | Test with dry runs, a local index using `NETWORK=test`, and identifiers under GS1 demonstration prefix 952. |
| Published acceptance records use older signing | `managed-custody@1` signs directly with the custodian identity key. The November candidate writes `managed-custody@2` acceptance records with derived keys through a BRC-100 wallet. | Preserve old records and verify each under its own rule. Follow [candidate migration](../migration.md#test-the-november-source-candidate) before changing signers. |
| Candidate acceptance records have no dedicated retrieval route | With the chain alone, a stranger reads `evidenceAvailability` `unknown`, `referenced-artefact-unavailable` on a managed `TRANSFER`. Neither index nor registry serves individual records. | Export the custodian's evidence package: records travel under `authority`; read them with `acceptanceRecordsInPackage` from `@bsv/dpp-protocol`. |
| Owner tier ciphertext has no fixed location | The state holds only its hash; holders and later recipients need another source. | Serve its UHRP content address, already given by that hash ([record model](https://github.com/bsv-blockchain/dpp/blob/7e0e9386bc0af9ae0e941c2d0676845c3ac513ea/spec/record-model.md), section 7). |

## Index host

| Limit | Effect | Action |
|---|---|---|
| Candidate registration retains every policy entry | Each registration appends a `dpp-publisher-policy@1` version containing every earlier entry, including retired entries. The served chain grows with the square of the entry count. | Prefer `REGISTRATION=approval` on publicly reachable indexes. |
| Candidate registration has a 256-entry cap | Each policy version holds at most 256 publishers. At the cap, the index answers `503 registration-unavailable`; revocation frees no space. | Ask the operator to start a new scope before reaching the cap. |
| Candidate command-line policy updates are not immediate | A version appended by the operator reaches the running index at its next registration request, `GET /publisher-policy` or restart. | Account for that delay when changing admission. |
| Operator tokens are shared secrets | Everyone given `SUBMIT_TOKEN`, `ARC_CALLBACK_TOKEN` or `EXPORT_TOKEN` shares its value; requests cannot be distinguished. Candidate per-publisher tokens (`dpp-index connection` or `dpp-index tokens issue`) distinguish `/submit`, `/retract` and `/arc-ingest` writers. Complete exports still use only shared `EXPORT_TOKEN`. | On the candidate, issue per-publisher tokens; reserve operator tokens for operator tools. Limit outside export access in time, then replace `EXPORT_TOKEN`. |
| Discovery finds only advertised indexes | `SYNC_DISCOVERY=ship` pulls from SHIP-advertised indexes trackers return for its topics, alongside named peers. An advert proves only that a key signed it; admission is unchanged. New indexes need `ADVERTISE=1` to be found. Beta.9 neither discovers nor advertises. | Put relied-on peers in `SYNC_PEERS`; [discover others](federation.md#parked-find-peers-automatically) and [advertise your index](federation.md#parked-advertise-your-index). |
| Nothing revokes adverts | After a move or shutdown, trackers still return old SHIP/SLAP adverts. Discovering indexes find nothing and back off. | Spend old tokens with the advertiser's wallet; the index never does ([advertising](federation.md#parked-advertise-your-index)). |
| WhatsOnChain is the only header source | Inclusion trusts its headers. Anonymous access allows a few requests a second. Outages drop proven states during synchronisation; five failed rounds leave them behind until retry. | Set `WOC_API_KEY`; no alternative-header setting exists. [Move checkpoints back](federation.md#move-a-checkpoint-back) for missed states rather than waiting. |
| No published operator image | Operators build from a checkout. | Use the Compose preset in [run a service](README.md). |
| History/export snapshots expire after ten minutes | Longer pauses require restarting pagination; process restarts or another answering replica also lose the cursor. | Page promptly; restart when the cursor is lost. |
| `GET /evidence-package` includes only the newest 500 states | Longer histories are truncated. | Use the reference package's `GET /evidence-export` ([recovery](export-import-recovery.md)), a feature outside the standard. |
| `CHAIN_TRACKER=scripts-only` skips header checks | The index would admit unproven ancestry. | Use only for local development. |
| The signing example handles only a first, single-operator version | No ready-made tool signs a first version with multiple operators or a later chain version. | Sign `policySigningPreimage(policy)` from `@bsv/dpp-protocol` with every required key; check with `verifyPolicyChain` ([federation step 3](federation.md#3-sign-a-publisher-policy)). |
| A refused announcement spending a tip marks it spent in the engine | Lookups and history stay unchanged, but peers are no longer offered that tip. | Announce a valid successor; peers are then offered it with its lineage. |

## Synchronisation

| Limit | Effect | Action |
|---|---|---|
| Synchronisation only pulls | An index receives records only from named or discovered peers; that gives the peer nothing. | [Each side names the other](federation.md#which-way-records-flow), or advertises itself and discovers the other. |
| Discovered peers have no page or time budget | The overlay SDK requests up to 10,000 outputs per page (reference indexes return at most 500), continuing while pages are full. It fetches every output's graph without a time limit. Rounds never overlap, so large or slow peers delay every round. | Lower `SYNC_MAX_DISCOVERED`, choose `SLAP_TRACKERS`, or disable discovery and name peers ([discovery](federation.md#parked-find-peers-automatically)). |
| States funded from another passport's change wait for mining | Peers lacking that history leave the state behind. `@bsv/overlay` up to 2.6.2 does not tell the topic which output it reached. | Wait for the first round after mining. |
| Later states of a passport already held wait for mining | Synchronisation cannot assemble unproven states over a held lineage. The previous tip remains until the source index receives the proof. A new passport arrives unproven. | [Push the proof](wallet-broadcast-proofs.md#follow-one-write) to the index you announced the state to; the next round carries state and proof. |
| Missed outputs wait for back-off | After five rounds the checkpoint advances; the index asks for it again after about an hour of rounds, doubling to about a day. The in-memory schedule is lost on restart. Retry alone fixes nothing; beta.9 never retries. | Fix the cause and [move the checkpoint back](federation.md#move-a-checkpoint-back) rather than waiting ([read the log](federation.md#read-the-synchronising-indexs-log)). |
| Only the receiving index logs why an output did not arrive | Peers cannot query the reason. | Read that index's log. |
| Only current outputs and their lineages synchronise | Separately retained evidence does not travel. | Use [exports](export-import-recovery.md). |
| Admission settings determine which records peers hold | Each uses its own publisher policy and `ANCHOR_SERVICE_KEYS`; `tm_uora_dpp` requires `SYNC_LEGACY=1`. Narrower settings retain less. | Match settings, then [compare held records](federation.md#7-confirm-both-hold-the-same-records). |
| Lookup BEEF depends on how a state arrived | Byte comparison can fail for identical states. | Compare transactions and merkle paths as `spec/services.md` section 1 defines, not BEEF bytes. |

## Proofs and retraction

| Limit | Effect | Action |
|---|---|---|
| Later proofs do not synchronise | Indexes keep the first bytes received; synchronised unproven states stay unproven. | Push proofs to every holding index's `POST /arc-ingest`, using its own callback token ([wallet, broadcast and proofs](wallet-broadcast-proofs.md)). |
| No duty assigns delivery of later proofs to peers | No writer or gateway is responsible yet. | Agree delivery with peer operators. |
| Retraction does not propagate | Synchronisation carries admissions only, so a peer that pulled a withdrawn state keeps serving it as the tip. | The peer's operator withdraws it with their own `POST /retract` ([federation](federation.md#when-a-record-does-not-arrive)); tell peer operators, as for proofs. |

## Capability documents

| Limit | Effect | Action |
|---|---|---|
| An index on an earlier release names no exporter key | Its capability document carries no `exporterIdentityKey`, and its packages are signed with a raw key. | Use the [hosted reference key](../deployment.md#the-hosted-reference); ask other operators for theirs. From this release an index names `exporterIdentityKey`, which you still compare with the key its operator gives you. |
| Operator names bind no key | Documents can share a name. | [Distinguish operators by keys](federation.md#tell-operators-apart). |
| Registry capabilities have two definitions | The capabilities schema and registry contract locate the anchoring key differently; which document `GET /capabilities` returns is unsettled. | Conform by serving the schema document with the anchoring key under `publisherPolicy.anchoringServices`. Verifiers read that or the contract's `anchoredBy` ([registry](../implement/roles/registry.md#the-minimum-a-registry-serves)). |

## Finding records

| Limit | Effect | Action |
|---|---|---|
| A GTIN and serial find a passport only on the current release | Earlier indexes need the exact identifier, including its host, or chip `uid`. `01/<gtin>/21/<serial>` alone finds nothing under another host. GS1-key lookups find only passports that index holds. | Use `gs1Key` on the current release; otherwise request the [full address](../identifiers.md#use-the-identifier-throughout-the-request). |
| No discovery maps publishers to indexes | A passport identifier alone cannot locate its states. | Obtain the index from the publisher, for example its passport page. |
| Anchors do not identify their registry | Registries do not exchange claims. Anchors are findable on holding indexes, but fetching claim bytes requires a known registry. | Obtain it from the publisher. Without bytes, claim checks read `unknown` ([registry](../implement/roles/registry.md#the-minimum-a-registry-serves)). |
| No directory maps brands to keys | Readers get issuer/publisher keys from brands or applications. | Keep accepted keys as [trusted parties](../packages/dpp-protocol.md#gather-a-passports-evidence). |

## Registry

| Limit | Effect | Action |
|---|---|---|
| No registry package, image or public reference code | Implement against the contract. | Follow [the registry guide](../implement/roles/registry.md); compare hosted responses. |
| Registry exports are scoped | They lack token history, restricted evidence and keys. | [Retain these separately](export-import-recovery.md). |
| Hosted registry has no complete export | One-step export is unavailable. | Page `GET /attestations`. |

## The verification report

| Limit | Effect | Action |
|---|---|---|
| Candidate token-payload schema checks need a caller validator | Published readers do not check token payload profiles. Without policy `payloadValidator`, candidate `schema` is `unknown` for every token state. A payload declaring no profile produces `unknown`, `profile-undeclared` either way. | Supply `profilePayloadValidator(ajv)` from `@bsv/dpp-profiles` as `payloadValidator` ([profiles](../packages/dpp-profiles.md#check-a-payload-against-its-profile)); declare `profile` and `profile_version` in every payload. |
| Identity assurance is Ring 0 | The platform vouches for account and brand name; nobody checks legal identity. | Treat the name as the [platform's statement](../learn/identity-and-authority.md). |

## The hosted reference

| Limit | Effect | Action |
|---|---|---|
| Writes require operator tokens | Without them, you cannot announce to the index or store on the registry. | Run your own index or [contact the programme](../start/choose-your-path.md#contact-the-programme). |
| `dpp.bsvb.net/verify` reads only the hosted index | Your index's passports remain not found until the hosted index pulls them. | Use [your own reader](../quick-start.md#read-a-live-passport). |
| Hosted registry capabilities omit its anchoring key | Verifiers cannot obtain the key there. | Use the [documented key](../deployment.md#where-the-hosted-services-fall-short). |

## Resolved in the November candidate

These rules have source implementation support. They remain unavailable through an npm upgrade; applications must integrate the workflow.

| Former open question | Candidate rule |
|---|---|
| Disclosure of the `legitimate` and `authority` tiers | One owner commitment covers the restricted object. Each disclosure is re-encrypted to an authorised reader's identity key and includes only their entitled tiers ([record model](https://github.com/bsv-blockchain/dpp/blob/7e0e9386bc0af9ae0e941c2d0676845c3ac513ea/spec/record-model.md), section 7). |
| Writing for a holder after a hand on | A custodian's update or retirement for a managed holder depends on custody: the chain cannot show that the holder asked, and the verification report's limits say so. The instruction record that once recorded the request is parked outside the standard ([parked instruction records](../reference/parked/managed-instruction/README.md)). |
| Managed transfer locking key | Each state's output locks to its field-6 controller key. The custodian wallet spends for managed identities; recipients supplying their own derived destination key can spend from their own wallet ([managed custody](https://github.com/bsv-blockchain/dpp/blob/1d610d7a66ab571756cb406b8654f0751e924036/spec/managed-custody.md), section 2). |
| Structured lifecycle-claim data | Native claims carry no evidence facets; a profile mapping reads its facets from other evidence, such as a state's `event_data`, and `recordId` identifies the state outpoint `<txid>:<outputIndex>` ([claim rules](https://github.com/bsv-blockchain/dpp/blob/1d610d7a66ab571756cb406b8654f0751e924036/spec/rules.md), sections 3 and 4). |

## Open questions in the standard

Do not invent answers. Allow for changes, and stop a dependent operation until its required decision is made.

| Question | Where it stands |
|---|---|
| Operation-specific `event_data` fields | No profile defines them. |
| Creating/updating `did:bsv` from public material | Not shown; Ring 0 writers need no `did:bsv` ([BSV DIDs](../learn/dids.md)). |
| Profile versioning and canonical definitions | Until governance is settled, frozen `@bsv/dpp-profiles` manifests define them ([status](../start/status.md)). |
| Remaining decisions and boundaries | Older-anchor issuer formats, long-term reference-index hosting, companion-profile submission and brand self-custody remain in [open decisions](../start/status.md#open-decisions). The fixture runner's [source gaps](../implement/fixture-runner.md#source-gaps) cover canonical key ordering and pre-1.0 precedence. |
