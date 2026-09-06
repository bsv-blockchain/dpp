#!/usr/bin/env node
/**
 * Resolve a GS1 Digital Link the way spec/gs1-discovery.md says a resolver
 * and a discovery client do, from the packaged helpers alone: read the URI,
 * decompress it when it carries an EPC binary string, resolve it against a
 * few demonstration records, build the linkset a GS1-Conformant Resolver
 * would return, and select one link from that linkset as a client would.
 *
 *   node examples/resolve-digital-link.mjs
 *   node examples/resolve-digital-link.mjs https://id.example.org/01/09521234000013/21/SER-0001?linkType=gs1:pip
 *   node examples/resolve-digital-link.mjs https://example.com/exMBZFlvQMDly-mRqD
 *
 * Every host is an example name and every GTIN is under the demonstration
 * prefix 952 or is GS1's own worked example; nothing here is a real product.
 * Results print one sentence per finding, never a score. A link inherited
 * from the model level is reported as model information, which is the point
 * of printing the anchor beside every link.
 */
import {
  DPP_EVIDENCE_PACKAGE_LINK_TYPE,
  GS1_LINK_TYPES,
  decompressGs1DigitalLink,
  describeResolver,
  gs1KeyOf,
  gs1KeyTuple,
  linksetDocument,
  parseAcceptLanguage,
  parseGs1DigitalLinkUri,
  resolutionRecordProblems,
  resolveLinks,
  selectLink,
} from '@bsv/dpp-profiles'

const ROOT = 'https://id.example.org'
const GTIN = '09521234000013'
const input = process.argv[2] ?? `${ROOT}/01/${GTIN}/10/LOT-2026-01/21/SER-0001`

let failures = 0
const say = (ok, sentence) => {
  console.log(`${ok ? 'Holds:' : 'FAILS:'} ${sentence}`)
  if (!ok) failures++
}

// The records one demonstration resolver holds: the model, one lot and one item.
const records = [
  {
    key: { ai: '01', value: GTIN },
    qualifiers: [],
    configurationRevision: 'example-1',
    description: 'Demonstration cell pack',
    links: [
      { rel: GS1_LINK_TYPES.pip, href: 'https://products.example.org/cell-pack', title: 'Product information', default: 'single', disclosure: 'public' },
      { rel: GS1_LINK_TYPES.pip, href: 'https://products.example.org/fr/cell-pack', title: 'Fiche produit', hreflang: ['fr'], default: 'multi', disclosure: 'public' },
      { rel: GS1_LINK_TYPES.sustainabilityInfo, href: 'https://products.example.org/cell-pack/sustainability', title: 'Sustainability', type: 'text/html', disclosure: 'public' },
      { rel: GS1_LINK_TYPES.epcis, href: 'https://epcis.example.org/events', title: 'Event query service', type: 'application/json', disclosure: 'restricted' },
    ],
  },
  {
    key: { ai: '01', value: GTIN },
    qualifiers: [{ ai: '10', value: 'LOT-2026-01' }],
    configurationRevision: 'example-1',
    links: [{ rel: GS1_LINK_TYPES.recallStatus, href: 'https://products.example.org/recalls/LOT-2026-01', title: 'Recall status', disclosure: 'public' }],
  },
  {
    key: { ai: '01', value: GTIN },
    qualifiers: [{ ai: '21', value: 'SER-0001' }],
    passportId: `https://dpp.example.org/01/${GTIN}/21/SER-0001`,
    bindingRef: 'the genesis state that carries this identifier',
    configurationRevision: 'example-1',
    links: [{ rel: DPP_EVIDENCE_PACKAGE_LINK_TYPE, href: 'https://registry.example.org/passports/example/evidence-package', title: 'Evidence package', type: 'application/json', disclosure: 'public' }],
  },
]
for (const record of records) {
  const problems = resolutionRecordProblems(record)
  say(problems.length === 0, `the record at ${record.qualifiers.map((q) => `${q.ai}=${q.value}`).join(' ') || 'the GTIN level'} is admissible${problems.length === 0 ? '' : `: ${problems.join('; ')}`}.`)
}

// 1. The URI, read or decompressed.
let parsed = parseGs1DigitalLinkUri(input)
if (parsed.kind === 'compressed') {
  const decompressed = decompressGs1DigitalLink(input)
  say(decompressed.ok, decompressed.ok ? `the compressed form decodes under the ${decompressed.epc.scheme} scheme to ${decompressed.uri} (EPC ${decompressed.epc.epcUri}).` : `the compressed form is refused: ${decompressed.reason}, ${decompressed.detail}.`)
  if (!decompressed.ok) process.exit(1)
  parsed = parseGs1DigitalLinkUri(decompressed.uri)
}
say(parsed.kind === 'uncompressed', parsed.kind === 'uncompressed' ? `the URI names GTIN ${parsed.primaryKey.value}${parsed.qualifiers.map((q) => `, ${q.ai} ${q.value}`).join('')}, check digit ${parsed.primaryKey.checkDigitValid ? 'holds' : 'fails'}${parsed.primaryKey.demonstration ? ', under the demonstration prefix' : ''}.` : `the URI is refused: ${parsed.reason}, ${parsed.detail}.`)
if (parsed.kind !== 'uncompressed') process.exit(1)
const key = gs1KeyOf(parsed)
say(true, `its key tuple is ${gs1KeyTuple(key)}; a URI under any other host with this tuple names the same entity, and this says nothing about who allocated the GTIN.`)

// 2. Resolution as the hosted resolver does it, for a public audience.
const request = { key, audience: 'public', resolverRoot: ROOT, linkType: parsed.linkType?.iri, acceptLanguage: parseAcceptLanguage('fr, en;q=0.5') }
const outcome = resolveLinks(records, request)
switch (outcome.outcome) {
  case 'no-records':
    say(true, 'this resolver holds nothing under that key: 404, with nothing beside it.')
    break
  case 'redirect':
    say(true, `the resolver redirects to ${outcome.link.href}, a ${outcome.link.granularity}-level link anchored at ${outcome.link.anchor}${outcome.link.granularity !== 'item' && key.qualifiers.some((q) => q.ai === '21') ? ', so it is model information the item inherits, not an item fact' : ''}.`)
    break
  case 'multiple-choices':
    say(true, `the resolver cannot choose between ${outcome.candidates.length} links of that type: 300 with the candidates.`)
    break
  case 'not-found':
    say(true, `no link of type ${outcome.requested} exists: 404, with ${outcome.links.length} other links listed.`)
    break
  default:
    say(true, `the resolver returns the linkset.`)
}
if (outcome.outcome !== 'no-records') {
  say(outcome.matched.length > 0, `the request matched ${outcome.matched.length} registration level${outcome.matched.length === 1 ? '' : 's'}: ${outcome.matched.map((m) => `${m.granularity} at ${m.anchor}`).join('; ')}.`)
  say(!outcome.links.some((l) => l.disclosure === 'restricted'), 'no restricted link reached the public audience.')
}

// 3. The linkset, and a client's selection over it.
const linkset = linksetDocument(records, { key, audience: 'public', resolverRoot: ROOT })
if (linkset != null) {
  say(linkset.linkset.every((entry) => entry.anchor.startsWith(`${ROOT}/01/`)), `the linkset anchors ${linkset.linkset.length} link context object${linkset.linkset.length === 1 ? '' : 's'} at uncompressed URIs under the resolver root.`)
  const selected = selectLink(linkset, { rel: 'gs1:pip', language: 'fr' })
  say(selected.outcome === 'selected', selected.outcome === 'selected' ? `a client asking for gs1:pip in French selects ${selected.link.href}, whose anchor is ${selected.scope.granularity}-level.` : `a client asking for gs1:pip in French gets ${selected.outcome}.`)
  const evidence = selectLink(linkset, { rel: DPP_EVIDENCE_PACKAGE_LINK_TYPE })
  say(true, evidence.outcome === 'selected' ? `the evidence package link is ${evidence.link.href}, at the ${evidence.scope.granularity} level.` : `no evidence package link is registered at any level this request reaches; available relations: ${evidence.outcome === 'not-found' ? evidence.available.join(', ') : 'ambiguous'}.`)
  const events = selectLink(linkset, { rel: 'gs1:epcis' })
  say(events.outcome === 'not-found', 'the restricted event service is absent from the public linkset, and the client learns only that the relation is unavailable.')
}

// 4. The description file the resolver origin publishes.
const description = describeResolver({ resolverRoot: ROOT, name: 'Demonstration resolver' })
say(description.supportedPrimaryKeys.length === 1 && description.supportedPrimaryKeys[0] === '01', `the description file at ${ROOT}/.well-known/gs1resolver declares primary key 01 only and the gs1: and dpp: namespaces.`)

console.log(failures === 0 ? 'Every sentence above holds.' : 'At least one sentence above does not hold.')
process.exit(failures === 0 ? 0 : 1)
