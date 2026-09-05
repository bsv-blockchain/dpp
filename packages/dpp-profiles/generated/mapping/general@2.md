# Field mapping inventory: general@2

Generated from `manifests/general@2.json` by the profiles generator. One row per declared field. The external semantic field is the manifest's semantic URI where one is recorded and `not mapped` otherwise; obligation and legal basis are separate columns because one is this profile's requirement and the other is the instrument that asks, or the statement that none does. `needs review` marks what no generator can decide: a conditional applicability, or the evidence a value needs. Nothing here is a legal conclusion, and no external exchange vocabulary is mapped until its artefacts are pinned.

Regulatory line: No rule covers these products, and none is claimed. The record follows the same shape as the regulated profiles so a maker who later falls in scope is already close to it.

- Applicability statement (needs-review): No instrument requires a passport for these products, and none is cited as if one did; every field states that in its legal basis.

| Key | Label | External semantic field | Type, unit, list | Granularity | Obligation | Legal basis | Applicability | Access tier | Captured by | Evidence required |
|---|---|---|---|---|---|---|---|---|---|---|
| name | Product name | not mapped | text | model | required | Nothing requires this. A record with no name is not a passport. | always | public | the registering maker, at registration | needs review |
| category | Kind of object | not mapped | enum, open list (9) | model | required | Nothing requires this. It decides which of the fields below make sense. | always | public | the registering maker, at registration | needs review |
| manufacturer | Maker | not mapped | text | model | required | Nothing requires this. On a handbuilt object the maker is the claim. | always | public | the brand record, supplied once | needs review |
| manufacturerContact | How to reach the maker | not mapped | text | model | required | Nothing requires this. A guarantee nobody can claim against is decoration. | always | public | the brand record, supplied once | needs review |
| modelIdentifier | Model or reference | not mapped | id | model | recommended | Nothing requires this. It is how a maker finds the drawings again. | always | public | the registering maker, at registration | needs review |
| serialNumber | Serial number | not mapped | id | item | recommended | Nothing requires this. It is the commonest way an object proves it is the one. | always | public | the registering maker, at registration | needs review |
| manufacturingPlace | Where it was made | not mapped | record | model | recommended | Nothing requires this. Place is half of provenance. | always | public | the registering maker, at registration | needs review |
| made | Made | not mapped | monthYear | item | recommended | Nothing requires this. Age is what a durable object is judged on. | always | public | the registering maker, at registration | needs review |
| dimensions | Dimensions | not mapped | text | model | recommended | Nothing requires this. It is what a second buyer asks first. | always | public | the registering maker, at registration | needs review |
| weight | Weight | not mapped | decimal, in g | model | recommended | Nothing requires this. | always | public | the registering maker, at registration | needs review |
| edition | Edition | not mapped | text | item | recommended | Nothing requires this. On a limited run it is most of the value. | always | public | the registering maker, at registration | needs review |
| makerName | Made by | not mapped | text | item | recommended | Nothing requires this. It is the difference between made and manufactured. | always | public | the registering maker, at registration | needs review |
| authentication | How to tell it is the real one | not mapped | multi, open list (6) | model | recommended | Nothing requires this. It is the question a passport exists to answer. | always | public | the registering maker, at registration | needs review |
| certificate | Certificate | not mapped | document | item | recommended | Nothing requires this. The paper certificate, kept where it cannot be lost. | always | public | the registering maker, at registration | the referenced document, hashed |
| commission | Made for | not mapped | text | item | optional | Nothing requires this. Published only where the first owner wanted it published. | always | public | the registering maker, at registration | needs review |
| materials | Materials | not mapped | record | model | required | Nothing requires this. It is the first thing a repairer needs and the last thing a recycler needs. | always | public | the registering maker, at registration | needs review |
| method | How it was made | not mapped | enum, open list (5) | model | recommended | Nothing requires this. It is most of what a buyer is paying for. | always | public | the registering maker, at registration | needs review |
| finish | Finish | not mapped | text | model | recommended | Nothing requires this. | always | public | the registering maker, at registration | needs review |
| notes | Anything else worth recording | not mapped | text | model | optional | Nothing requires this. It is what keeps a declared profile usable for objects nobody has thought of. | always | public | the registering maker, at registration | needs review |
| recycledContent | Recycled content | not mapped | percent, in % | model | optional | Nothing requires this. Declared where a maker can substantiate it. | always | public | the registering maker, at registration | needs review |
| substanceStatement | Substances to handle with care | not mapped | text | model | recommended | Nothing requires this here, though REACH Art. 33 may require it of the article itself. | always | public | the registering maker, at registration | needs review |
| careNote | How to look after it | not mapped | text | model | required | Nothing requires this. It is the single field most likely to extend the object’s life. | always | public | the registering maker, at registration | needs review |
| serviceInterval | Service interval | not mapped | text | model | recommended | Nothing requires this. | always | public | the registering maker, at registration | needs review |
| expectedLifetime | Expected lifetime | not mapped | integer, in years | model | recommended | Nothing requires this. A claim made here is one the maker can be held to. | always | public | the registering maker, at registration | needs review |
| guarantee | Guarantee | not mapped | integer, in months | model | recommended | Nothing requires the figure, though a stated commercial guarantee binds the maker. | always | public | the registering maker, at registration | needs review |
| guaranteeTerms | Guarantee terms | not mapped | document | model | recommended | Nothing requires this. A term with no conditions attached is not a guarantee. | always | public | the registering maker, at registration | the referenced document, hashed |
| repairability | What can be repaired | not mapped | text | model | recommended | Nothing requires this. | always | public | the registering maker, at registration | needs review |
| spareParts | Spare parts | not mapped | text | model | recommended | Nothing requires this. It is what decides whether the object outlives its owner. | always | public | the registering maker, at registration | needs review |
| repairInstructions | Repair notes | not mapped | document | model | recommended | Nothing requires this. | always | public | the registering maker, at registration | the referenced document, hashed |
| repairServices | Where to get it repaired | not mapped | url | model | recommended | Nothing requires this. | always | public | the registering maker, at registration | needs review |
| serviceNotes | Workshop notes | not mapped | text | model | recommended | Nothing requires this. Restricted because it is useless to a consumer and valuable to a repairer. | always | legitimate | the registering maker, at registration | needs review |
| collection | Where to return it | not mapped | text | model | recommended | Nothing requires this. A maker who takes it back says so here. | always | public | the registering maker, at registration | needs review |
| recyclability | What can be recovered | not mapped | text | model | recommended | Nothing requires this. | always | public | the registering maker, at registration | needs review |
| separability | What comes apart | not mapped | text | model | recommended | Nothing requires this. | always | legitimate | the registering maker, at registration | needs review |
| supplyChain | Supply chain | not mapped | record | model | optional | Nothing requires this. Declared by makers who treat their suppliers as a credential. | always | public | the registering maker, at registration | needs review |
| certifications | Independent certification | not mapped | multi, open list (0) | model | optional | Nothing requires this. | always | public | the registering maker, at registration | needs review |
| provenance | Provenance | not mapped | text | item | optional | Nothing requires this. It is the owner tier the selective-disclosure demo turns on. | always | owner | the registering maker, at registration | needs review |
| purchase | Purchased | not mapped | text | item | optional | Nothing requires this. It is what makes the record theirs. | always | owner | the registering maker, at registration | needs review |
| personalisation | Fitting and setup | not mapped | text | item | optional | Nothing requires this. A fitted object is a different object to its owner. | always | owner | the registering maker, at registration | needs review |
| valuation | Valuation reference | not mapped | text | item | optional | Nothing requires this. Owner tier only, and no figure ever reaches the public payload. | always | owner | the registering maker, at registration | needs review |
