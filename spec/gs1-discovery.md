# GS1 discovery

**Profile: `gs1-digital-link@1`. Status: proposed, pre-1.0.** This document holds the rules a passport identified by a GS1 Digital Link URI follows beyond the GS1 standards themselves. Everything else is GS1's and is cited, never restated: a Digital Link is read under GS1 Digital Link: URI Syntax 1.7.0, its compressed form under GS1 Digital Link URI: Compression Technical Standard for EPC binary strings 1.0.0 with the EPC Tag Data Standard, and resolution, link types, linksets and the resolver description file under GS1-Conformant Resolver 1.2.1. It changes nothing about the passport identifier itself, which [`record-model.md`](record-model.md) §3 and [`profiles.md`](profiles.md) §5 define, and nothing about credential subjects, which stay exactly as signed.

## 1. The identifier rules

When `passport_id` is a GS1 Digital Link URI ([`record-model.md`](record-model.md) §3):

1. **Allocation.** The GTIN under application identifier 01 is allocated under a GS1 Company Prefix licensed to the brand the record describes, or to that brand by its GS1 Member Organisation; a record that describes no real product uses the demonstration prefix 952 ([`record-model.md`](record-model.md) §3, [`profiles.md`](profiles.md) §5). Syntax, a correct check digit, a decodable EPC, a resolvable DID or ownership of a host prove nothing about who GS1 allocated a number to, and nothing in this profile infers allocation authority.
2. **Writing.** A writer writes the GTIN at fourteen digits with a correct check digit and never publishes one that fails it ([`record-model.md`](record-model.md) §3, [`profiles.md`](profiles.md) §5).
3. **Reading.** A reader reports the check digit and never enforces it, because historical records carry GTINs that fail it: such a passport is read and verified like any other.
4. **The notice stamp.** A record under the demonstration prefix SHOULD carry `notice`, and a record about a real product MUST NOT, as [`profiles.md`](profiles.md) §5 says.
5. **Host continuity.** The host an identifier is minted under, its resolver and any linkset are mutable service metadata. A change of provider changes where the identifier is answered, never the identifier, the genesis or the history, and a writer that stops serving a host keeps it answering for what it minted there where it can ([`record-model.md`](record-model.md) §3, [`profiles.md`](profiles.md) §5).
6. **The minting host.** The host an identifier is minted under SHOULD be a GS1-Conformant Resolver for primary key 01, answering every path under `/01/` as that standard says; a host that is not one SHALL answer every path under `/01/` with 307 Temporary Redirect to the same path and query string under a resolver that is. The resolver standard names no status code for a redirect, so 307 is this profile's choice; passing the whole query string on follows resolver standard §2.12.

Nothing in this document requires an application account, a wallet or a DID of anyone who scans a code.

## 2. Normative and implementation

What a conforming party reproduces: the six rules of §1, and the GS1 standards it cites for whatever it resolves or reads. What is a build's own: whether its identifier host resolves or redirects to a resolver, which resolver that is, how its records are stored, administered or synthesised, and the passport page's URL and content.

The helpers in `@bsv/dpp-profiles` (`gs1-resolution.ts`, `gs1-epc-binary.ts`), the manifest `packages/dpp-profiles/manifests/interoperability/gs1-digital-link@1.json`, the GS1 artefacts that manifest pins by digest, which GS1 publishes under its own terms and this repository does not carry, and the vectors under `fixtures/vectors/dpp/interoperability/gs1/` are reference code for those GS1 standards, not further rules of this one. They name a passport's evidence package under the relation `https://dpp.bsvb.net/link/evidencePackage/1`, where the GS1 vocabulary has no term, and register an event repository only under `gs1:epcisRepository`.
