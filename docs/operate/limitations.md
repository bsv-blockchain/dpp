# Known limitations and open questions

Everything that does not work yet, or is not settled, in one place, for writers, readers and operators alike. Skim it before you start, and come back when something does not arrive or a check reads `unknown`. Other pages link here instead of restating a limit.

Match a limit to the version you use. Unless a row says otherwise, the implementation limits below describe the selected published set, including overlay `0.4.0-beta.10`; a row that names an earlier version describes that version. The [hosted reference](../deployment.md) reports its own capabilities, which name the version it runs. An unresolved standard question remains open regardless of which checkout you build.

## Writing

| Limit | What it means for you | What to do now |
|---|---|---|
| Only a refused passport state says why | `X-Admission-Refusal` names the check a `tm_dpp` refusal failed. A refused anchor on `tm_attestation`, and any refusal by an index on an earlier release, answers `none` with the reason only in the operator's log | For an anchor, check before announcing that the index's `GET /capabilities` accepts its anchoring service; for an older index, check the causes [when the index refuses a state](../packages/build-an-application.md#when-the-index-refuses-a-state) names, and ask the operator for the log line |
| The capability document lists publisher keys without their windows or signatures | A key that `GET /capabilities` lists can still be refused for a state timestamped outside its window, and the list is the index's word | Take the signed chain from `GET /publisher-policy` and check it against the operator's identity key ([tell operators apart](federation.md#tell-operators-apart)); an index on an earlier release serves it only inside its evidence packages |
| The hosted services run on mainnet | Every write on them, and every write by a signed-in brand on the demonstration, is a real transaction that costs satoshis; the demonstration's sample brands write nothing to the chain | Use the examples' dry runs, a local index with `NETWORK=test`, and GS1 demonstration prefix 952 for test identifiers |
| A managed-custody custodian signs acceptance records with its identity key directly | A BRC-100 wallet cannot sign with its root key, so the custodian holds that key outside its wallet for now | Keep the custodian's key in secure storage outside the wallet |
| No route serves acceptance records | A stranger's report on a managed `TRANSFER` reads `evidenceAvailability` `unknown` with `referenced-artefact-unavailable` | Hand the record to the reader with the evidence; the custodian keeps it |
| Where the owner tier's ciphertext lives is not fixed | The state carries only the hash; a holder or later recipient must get the ciphertext from somewhere | Serve it by its UHRP content address, as the [record model](https://github.com/bsv-blockchain/dpp/blob/dab99763c76e4ab192a50b8dc88fe0bcb4c5ee8d/spec/record-model.md) section 7 recommends; the hash in the state is already that address |

## Index host

| Limit | What it means for you | What to do now |
|---|---|---|
| Each token is one shared secret | The index accepts one `SUBMIT_TOKEN`, one `ARC_CALLBACK_TOKEN` and one `EXPORT_TOKEN`, so everyone given a token holds the same value and requests cannot be told apart | Give each outside party a value only for as long as it needs one, and replace the value afterwards |
| Discovery finds advertised indexes and nothing more | With `SYNC_DISCOVERY=ship` an index pulls from the indexes whose SHIP adverts the trackers return for its topics, beside the peers it names. An advert proves only that a key signed it, admission is unchanged, and a new index is found only if it advertises with `ADVERTISE=1`; an index on beta.9 neither discovers nor advertises | Name the peers you rely on in `SYNC_PEERS` and turn discovery on for the rest ([find peers automatically](federation.md#find-peers-automatically)); advertise your own index so that others find it ([advertise your index](federation.md#advertise-your-index)) |
| Nothing revokes an advert | An index that moves host or stops leaves its SHIP and SLAP adverts in place; the trackers keep returning them, and indexes that discover the old address find nothing there and back off | Spend the old tokens with the advertiser's wallet when you move or stop; the index never does ([advertise your index](federation.md#advertise-your-index)) |
| The header source is WhatsOnChain only | Inclusion checks trust its headers, and anonymous use is limited to a few requests a second. While it fails, synchronisation drops proven states, and five failed rounds leave them behind until the back-off retry | Set `WOC_API_KEY`; there is no setting for another header service yet. Move a checkpoint back for anything left behind rather than waiting ([federation](federation.md#move-a-checkpoint-back)) |
| No operator image is published | You build the index from a checkout | Use the Compose preset in [run a service](README.md) |
| History and export snapshots expire after ten minutes | A paging client that pauses longer must start again | Page promptly; a cursor is also lost when the process restarts or another replica answers |
| `GET /evidence-package` carries at most the newest 500 states | Longer histories are cut short in that route | Use `GET /evidence-export` ([export, import and recovery](export-import-recovery.md)) |
| `CHAIN_TRACKER=scripts-only` skips header checks | The index would admit unproven ancestry | Use it for local development only |
| The signing example writes only a first, single-operator version | A first version naming two or more operators, and every later version of a chain, has no ready-made tool | Sign `policySigningPreimage(policy)` from `@bsv/dpp-core` with each key the version needs, and check the chain with `verifyPolicyChain` as [federation](federation.md#3-sign-a-publisher-policy) step 3 does |
| A refused announcement that spends a tip still marks that tip spent in the engine | Lookups and history answer as before, but synchronising peers are no longer offered that tip | Announce a valid next state; peers are then offered it with its lineage |

## Synchronisation

| Limit | What it means for you | What to do now |
|---|---|---|
| Synchronisation only pulls | A node receives records only from the peers its operator names or discovers; naming or discovering a peer gives that peer nothing | Each side names the other ([which way records flow](federation.md#which-way-records-flow)), or advertises itself and discovers the other |
| No page or time budget per discovered peer | The index sets no bound of its own on how much a round reads from a discovered peer or how long it takes: the overlay SDK asks for pages of up to 10,000 outputs and keeps reading while they come back full (a reference index answers at most 500 a page), fetches every graph behind each output with no time limit, and rounds do not overlap, so a large or slow discovered peer lengthens every round | Lower `SYNC_MAX_DISCOVERED`, name trackers you choose in `SLAP_TRACKERS`, or leave discovery off and name peers ([find peers automatically](federation.md#find-peers-automatically)) |
| A state funded from another passport's change waits until mined | A peer that lacks that other passport's history leaves the new state behind until it is mined; `@bsv/overlay` up to 2.6.2 does not tell the topic which output it reached | Wait for the first round after the state is mined |
| A later state of a passport the peer already holds waits until mined | Synchronisation cannot assemble an unproven state on top of a lineage the peer already holds, so the peer keeps the previous tip until the state's proof reaches the node it pulls from. A new passport arrives unproven | Push each proof to the index you announced the state to ([follow one write](wallet-broadcast-proofs.md#follow-one-write)); the first round after that carries the state with its proof |
| An output left behind is asked for again only after a back-off | After five rounds the checkpoint moves past it; the index asks for it again after about an hour of rounds, doubling to about a day, from a schedule kept in memory that a restart forgets. The retry resolves nothing by itself, and an index on beta.9 never asks again | Fix the cause, then [move the checkpoint back](federation.md#move-a-checkpoint-back) rather than waiting ([read the log](federation.md#read-the-synchronising-indexs-log)) |
| Why an output did not arrive is only in the receiving node's log | A peer cannot ask why | Read the receiving node's log |
| Synchronisation covers current outputs and their lineages | Separately retained evidence does not travel | Use [exports](export-import-recovery.md) |
| Peers hold the same records only under the same admission settings | Each index admits what it pulls under its own publisher policy and `ANCHOR_SERVICE_KEYS`, and pulls `tm_uora_dpp` only with `SYNC_LEGACY=1`, so a peer with narrower settings holds less | Match the settings, then [confirm both hold the same records](federation.md#7-confirm-both-hold-the-same-records) |
| Lookup BEEF differs in form by how a state arrived | Comparing two operators' answers byte for byte fails even when they hold the same states | Compare transactions and their merkle paths, as `spec/services.md` section 1 defines, not the BEEF bytes |

## Proofs and retraction

| Limit | What it means for you | What to do now |
|---|---|---|
| A later proof does not follow synchronisation | A node keeps the bytes it first received, so a peer that synchronised an unproven state stays unproven | Push each proof to every index that holds the state, through its own `POST /arc-ingest` with that index's own callback token ([wallet, broadcast and proofs](wallet-broadcast-proofs.md)) |
| Nobody is named to deliver later proofs to peers | No writer or gateway duty covers it yet | Agree it with the peers' operators |
| How a retraction reaches peers is not specified | A peer that synchronised a withdrawn state may keep it | Tell the peers' operators |

## Capability documents

| Limit | What it means for you | What to do now |
|---|---|---|
| The export signing key is not in the capability document | A reader checking an export has no published key to compare with | The [hosted reference](../deployment.md#the-hosted-reference) lists its key; ask other operators for theirs |
| An operator's name is bound to no key | Two documents can carry the same name | Tell operators apart by their keys ([federation](federation.md#tell-operators-apart)) |
| A registry has two capability documents | The capabilities schema and the registry contract define different documents, which name a registry's anchoring key in different places, and which one `GET /capabilities` answers with is not settled | Serve the schema's document to conform, with your anchoring key under `publisherPolicy.anchoringServices`; a verifier reads that or the contract document's `anchoredBy` ([registry](../implement/roles/registry.md#the-minimum-a-registry-serves)) |

## Finding records

| Limit | What it means for you | What to do now |
|---|---|---|
| A GTIN and serial find a passport only on the current release | An index on an earlier release looks a passport up only by its exact identifier, host included, or by a chip `uid`, so given `01/<gtin>/21/<serial>` alone it finds nothing issued under another host; a GS1 key finds only the passports that index holds | Ask an index on the current release with `gs1Key`; otherwise ask for the full address ([identifiers](../identifiers.md#use-the-identifier-throughout-the-request)) |
| Nothing names a publisher's index | A reader holding only a passport identifier cannot discover where its states are held | Learn the index from the publisher, for example from its passport page |
| An anchor does not name the registry that holds its claim | Registries do not exchange claims, so a reader finds the anchor on any index that holds it but must already know which registry to ask for the claim's bytes | Learn the registry from the publisher; without the bytes the claim's checks read `unknown` ([registry](../implement/roles/registry.md#the-minimum-a-registry-serves)) |
| No directory maps a brand to its keys | A reader must take a brand's issuer and publisher keys from the brand or its application | Keep your own list of the keys you accept, as the trusted parties in [gather a passport's evidence](../packages/dpp-core.md#gather-a-passports-evidence) show |

## Registry

| Limit | What it means for you | What to do now |
|---|---|---|
| No registry package, image or public reference code exists | You build a registry against the contract | Follow [the registry guide](../implement/roles/registry.md) and compare answers with the hosted registry |
| A registry export is a scoped archive | It has no token history, restricted evidence or keys | Keep those yourself ([export, import and recovery](export-import-recovery.md)) |
| The hosted registry serves no complete export | Its claims cannot be exported in one step | Page `GET /attestations` |

## The verification report

| Limit | What it means for you | What to do now |
|---|---|---|
| The report does not check a payload against its declared profile | A state with an invalid payload can pass every check | Run `node examples/sample-payload.mjs --check <profile@version> <file>`, with `--check` first, or validate with the profile's schema ([profiles](../packages/dpp-profiles.md)) |
| Identity assurance is Ring 0 | The platform vouches for an account and its brand name; nobody checks a brand's legal identity | Treat the brand name as the platform's statement ([identity and authority](../learn/identity-and-authority.md)) |

## The hosted reference

| Limit | What it means for you | What to do now |
|---|---|---|
| Writing needs the operator's tokens | You cannot announce to the hosted index or store on the hosted registry | Run your own index, or [contact the programme](../start/choose-your-path.md#contact-the-programme) |
| The check at `dpp.bsvb.net/verify` reads only the hosted index | A passport written to your own index reads as not found there until the hosted index pulls from yours | Verify with your own reader ([quick start](../quick-start.md#read-a-live-passport)) |
| The hosted registry does not name its anchoring key | A verifier cannot take the key its anchors are written by from its capability document | Use the key [the hosted reference](../deployment.md#where-the-hosted-services-fall-short) gives |

## Open questions in the standard

These are not settled. Do not invent an answer: build so that the answer can change.

| Question | Where it stands |
|---|---|
| How the `legitimate` and `authority` tiers are disclosed to the readers entitled to them | Not settled; the owner tier's encryption is defined, the others are not |
| Whether a custodian may write for a holder after a hand on | Not settled ([after a hand on](../packages/what-an-application-offers.md#after-a-hand-on)) |
| Which fields `event_data` carries for each operation | No profile defines them yet |
| Which key locks the output of a version 2 `TRANSFER` under managed custody | Not settled; check with the custodian's application before you rely on a lock |
| Whether a lifecycle claim may carry structured data beyond its event type and subject | Not settled; today a claim carries no further fields |
| How to create or update a `did:bsv` from the public material | Not shown yet; a writer at Ring 0 needs no `did:bsv` ([BSV DIDs](../learn/dids.md)) |
| Who versions a profile and where its canonical definition lives | Until settled, the frozen manifests in `@bsv/dpp-profiles` are the definitions ([where things stand](../start/status.md)) |
| The rest of the open decisions | [Where things stand](../start/status.md#open-decisions) and the fixture runner's [source gaps](../implement/fixture-runner.md#source-gaps) |
