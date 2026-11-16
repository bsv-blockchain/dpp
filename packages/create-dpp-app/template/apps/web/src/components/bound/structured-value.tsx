// A product document on a reader's page, drawn as the structure it has: a
// measurement as a value with its unit, text with its language, a code as a
// code, a list as a list and a nested object nested. Every property is
// shown, with the tier it was read from; one the page has no label for
// appears under the name the document gives it.
import { Mono, ToneBadge } from '@/components/bits'
import { TierBadge } from '@/components/bound/pieces'
import type { Shown, ShownProperty } from '@/lib/bound/display'
import { formatTime } from '@/lib/format'

export function StructuredValue({ shown }: { shown: Shown }) {
  switch (shown.kind) {
    case 'empty':
      return <span className="text-muted-foreground">none</span>
    case 'text':
      return <span className="whitespace-pre-wrap break-words">{shown.text}</span>
    case 'link':
      return <span className="break-all">{shown.href}</span>
    case 'date':
      return (
        <span>
          {shown.text.includes('T') ? formatTime(shown.text) : shown.text} {shown.text.includes('T') ? <Mono className="text-muted-foreground">{shown.text}</Mono> : null}
        </span>
      )
    case 'number':
      return <span className="tabular-nums">{shown.text}</span>
    case 'boolean':
      return <span>{shown.value ? 'Yes' : 'No'}</span>
    case 'langText':
      return (
        <span className="whitespace-pre-wrap break-words">
          {shown.text} <Mono className="text-muted-foreground">{shown.language}</Mono>
        </span>
      )
    case 'typed':
      return (
        <span className="tabular-nums">
          {shown.text} <Mono className="text-muted-foreground">{shown.type}</Mono>
        </span>
      )
    case 'quantity':
      return (
        <span className="tabular-nums">
          {shown.value} {shown.unitName} <Mono className="text-muted-foreground">{shown.unitCode}</Mono>
        </span>
      )
    case 'reference':
      return (
        <span>
          {shown.label} <Mono className="text-muted-foreground">{shown.id}</Mono>
        </span>
      )
    case 'list':
      if (shown.items.length === 0) return <span className="text-muted-foreground">none</span>
      return (
        <ol className="space-y-2">
          {shown.items.map((item, i) => (
            <li key={i} className={item.kind === 'object' ? 'rounded-md border p-2' : undefined}>
              <StructuredValue shown={item} />
            </li>
          ))}
        </ol>
      )
    case 'object':
      return (
        <div className="space-y-1">
          {shown.type == null && shown.id == null ? null : (
            <div className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
              {shown.type == null ? null : <Mono>{shown.type}</Mono>}
              {shown.id == null ? null : <Mono>{shown.id}</Mono>}
            </div>
          )}
          {shown.entries.length === 0 ? null : (
            <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-[minmax(8rem,1fr)_2fr]">
              {shown.entries.map((entry) => (
                <div key={entry.key} className="contents">
                  <dt className="text-muted-foreground" title={entry.key}>
                    {entry.label}
                  </dt>
                  <dd className="min-w-0">
                    <StructuredValue shown={entry.value} />
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )
  }
}

/** The top-level properties of a product document, each with the tier it was read from. */
export function ProductView({ properties }: { properties: ShownProperty[] }) {
  if (properties.length === 0) return <p className="text-sm text-muted-foreground">No product data was read.</p>
  return (
    <ul className="divide-y rounded-lg border text-sm">
      {properties.map((property) => (
        <li key={`${property.tier}:${property.key}`} className="grid grid-cols-1 gap-x-4 gap-y-1 p-3 sm:grid-cols-[minmax(10rem,1fr)_3fr]">
          <div className="space-y-1">
            <div className="font-medium">{property.label}</div>
            <div className="flex flex-wrap items-center gap-2">
              <TierBadge tier={property.tier} />
              {property.disclosed ? <ToneBadge tone="fail">Not listed as public</ToneBadge> : null}
            </div>
            <Mono className="text-muted-foreground">{property.key}</Mono>
          </div>
          <div className="min-w-0">
            <StructuredValue shown={property.value} />
          </div>
        </li>
      ))}
    </ul>
  )
}
