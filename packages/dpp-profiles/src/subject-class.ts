import type { EngineFile, EngineFinding, ShaclEngine, ShaclValidation } from './binding-validator.js'
import { namedObjects } from './semantic-identity.js'

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
const iri = (value: string): string => '<' + value.replace(/[\u0000-\u0020<>"{}|^`\\]/gu, (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0')) + '>'

/** Only product statements identify the subject's types. Only registered ontology statements establish subclass relationships. */
export async function checkSubjectClass(
  engine: ShaclEngine, subject: string | undefined, required: string, nquads: string, ontology: EngineFile[],
): Promise<ShaclValidation> {
  const types = subject == null ? [] : [...new Set(namedObjects(nquads, subject, RDF_TYPE))]
  if (types.includes(required)) return { ok: true, findings: [] }
  const finding: EngineFinding = {
    severity: 'Violation', constraint: 'ClassConstraintComponent', path: RDF_TYPE,
    ...(subject == null ? {} : { focusNode: subject }),
    message: `The product subject must have type ${required} or a subclass declared by the binding.`,
  }
  if (types.length === 0) return { ok: true, findings: [finding] }
  // Check each declared type against the trusted ontology. A type qualifies
  // when its transitive superclass path reaches the required class.
  const shape = `@prefix sh: <http://www.w3.org/ns/shacl#> .
    [] a sh:NodeShape ; sh:targetNode ${types.map(iri).join(', ')} ; sh:property [
      sh:path [ sh:zeroOrMorePath <http://www.w3.org/2000/01/rdf-schema#subClassOf> ] ;
      sh:hasValue ${iri(required)}
    ] .`
  const result = await engine.validate({
    nquads: '', shapes: [{ path: 'subject-class.ttl', mediaType: 'text/turtle', bytes: new TextEncoder().encode(shape) }], background: ontology,
  })
  if (!result.ok) return result
  const refused = new Set(result.findings.map((f) => f.focusNode))
  if (result.findings.some((f) => f.focusNode == null || !types.includes(f.focusNode) || f.constraint !== 'HasValueConstraintComponent')) {
    return { ok: false, reason: 'engine-error', detail: 'The class check returned a finding that could not be attributed to a declared product type' }
  }
  return { ok: true, findings: types.every((type) => refused.has(type)) ? [finding] : [] }
}
