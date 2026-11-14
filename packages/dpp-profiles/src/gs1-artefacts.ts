/**
 * The GS1-Conformant Resolver files the gs1-digital-link@1 profile is held
 * to, as facts: where GS1 publishes each one, its SHA-256 and its length.
 *
 * GS1 publishes these files under its own terms. This repository and its
 * packages do not redistribute them. No code in this package reads them; a
 * party that wants to validate a linkset or a resolver description file
 * against the published schemas obtains them from GS1 and checks every byte
 * against these digests. The table has the shape provisionGs1Artefacts of
 * @bsv/dpp-credentials accepts, so that function can do both.
 */

/** One pinned GS1 file: where GS1 publishes it and the exact bytes expected. */
export interface Gs1Artefact {
  readonly id: string
  /** The GS1 standard the file belongs to. */
  readonly standard: string
  readonly version: string
  /** The name the file has in a provisioned folder. A bare name, never a path. */
  readonly fileName: string
  /** The address GS1 publishes it at, under https://ref.gs1.org/. */
  readonly uri: string
  readonly sha256: string
  readonly byteLength: number
}

/** As retrieved unchanged from ref.gs1.org on 6 September 2026. The 1.2.1 standard points at the 1.2.0 description file schema. A changed upstream file is a new pinned version, never an edit of these facts. */
export const GS1_RESOLVER_ARTEFACTS = [
  { id: 'resolver-linkset-schema', standard: 'GS1-Conformant Resolver', version: '1.2.1', fileName: 'resolver-linkset-schema-1.2.1.json', uri: 'https://ref.gs1.org/standards/resolver/1.2.1/linkset-schema', sha256: 'd2e23510f17558c29f9d1baf9e112a70df42efd6557a49dc9a317048973669f2', byteLength: 4696 },
  { id: 'resolver-description-file-schema', standard: 'GS1-Conformant Resolver', version: '1.2.0', fileName: 'resolver-description-file-schema-1.2.0.json', uri: 'https://ref.gs1.org/standards/resolver/1.2.0/description-file-schema', sha256: '99d505c7aa2004cde3277651e8db0e019eab61d2746b2631ddab3fec8a13617e', byteLength: 3593 },
  { id: 'resolver-linkset-context', standard: 'GS1-Conformant Resolver', version: '1.2.1', fileName: 'resolver-linkset-context-1.2.1.jsonld', uri: 'https://ref.gs1.org/standards/resolver/1.2.1/linkset-context', sha256: '05792d010165fa6f28cc9cc3463cc1668f522ac75c26abe5b2877ec4a37b1312', byteLength: 838 },
] as const satisfies readonly Gs1Artefact[]
