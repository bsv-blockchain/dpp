// Small pieces every page uses: loading and error states, a copy button,
// coloured badges for check and journal answers, section headings and a
// definition list.
import { useState, type ReactNode } from 'react'
import { cn } from 'cn'
import { Check, Copy, LoaderCircle } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { ApiError, type CheckStatus } from '@/lib/api'
import { isRecord } from '@/lib/format'

export function Loading({ what = 'Loading' }: { what?: string }) {
  return (
    <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground" role="status">
      <LoaderCircle className="size-4 animate-spin" aria-hidden />
      {what}
    </p>
  )
}

export function ErrorNotice({ error, title = 'Something went wrong' }: { error: unknown; title?: string }) {
  const message = error instanceof Error ? error.message : String(error)
  const code = error instanceof ApiError ? error.code : undefined
  return (
    <Alert variant="destructive">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p>
          {message}
          {code == null ? null : <span className="ml-2 font-mono text-xs opacity-80">{code}</span>}
        </p>
      </AlertDescription>
    </Alert>
  )
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setFailed(false)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setFailed(true)
    }
  }
  return (
    <Button type="button" variant="ghost" size="icon-xs" onClick={copy} aria-label={copied ? 'Copied' : label} title={failed ? 'Copying is not available here' : label}>
      {copied ? <Check /> : <Copy />}
    </Button>
  )
}

export type Tone = 'pass' | 'fail' | 'unknown' | 'muted' | 'neutral' | 'warn'

const tones: Record<Tone, string> = {
  pass: 'border-transparent bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  fail: 'border-transparent bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200',
  unknown: 'border-transparent bg-neutral-200 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200',
  muted: 'border-border bg-transparent text-muted-foreground',
  neutral: 'border-transparent bg-secondary text-secondary-foreground',
  warn: 'border-transparent bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
}

export function ToneBadge({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  return (
    <Badge variant="outline" className={cn(tones[tone], className)}>
      {children}
    </Badge>
  )
}

const checkTones: Record<CheckStatus, { tone: Tone; label: string }> = {
  pass: { tone: 'pass', label: 'Pass' },
  fail: { tone: 'fail', label: 'Fail' },
  unknown: { tone: 'unknown', label: 'Unknown' },
  'not-applicable': { tone: 'muted', label: 'Not applicable' },
}

export function CheckBadge({ status }: { status: CheckStatus | string }) {
  const entry = checkTones[status as CheckStatus] ?? { tone: 'neutral' as Tone, label: status }
  return <ToneBadge tone={entry.tone}>{entry.label}</ToneBadge>
}

export function indexTone(answer: string): Tone {
  if (answer === 'admitted') return 'pass'
  if (answer === 'refused' || answer === 'unauthorised') return 'fail'
  if (answer === 'pending' || answer === 'unreachable' || answer === 'not-asked') return 'warn'
  return 'neutral'
}

export function networkTone(answer: string): Tone {
  if (answer === 'accepted') return 'pass'
  if (answer === 'refused') return 'fail'
  if (answer === 'pending' || answer === 'unanswered') return 'warn'
  if (answer === 'not-sent') return 'muted'
  return 'neutral'
}

export function statusTone(status: string): Tone {
  if (status === 'active' || status === 'open' || status === 'transferred') return 'pass'
  if (status === 'retired' || status === 'declined' || status === 'withdrawn' || status === 'expired') return 'muted'
  return 'neutral'
}

export function YesNo({ value }: { value: boolean }) {
  return <ToneBadge tone={value ? 'pass' : 'muted'}>{value ? 'Yes' : 'No'}</ToneBadge>
}

export function PageTitle({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description == null ? null : <div className="text-sm text-muted-foreground">{description}</div>}
      </div>
      {action == null ? null : <div className="shrink-0">{action}</div>}
    </div>
  )
}

export function Section({ title, children, action, className }: { title: ReactNode; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <section className={cn('space-y-3', className)}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

/** A value as the page shows it: text and numbers inline, anything else as JSON. */
export function ValueView({ value }: { value: unknown }) {
  if (value == null || value === '') return <span className="text-muted-foreground">none</span>
  if (typeof value === 'string') {
    if (/^https?:\/\//.test(value)) return <span className="break-all">{value}</span>
    return <span className="whitespace-pre-wrap break-words">{value}</span>
  }
  if (typeof value === 'number' || typeof value === 'boolean') return <span>{String(value)}</span>
  if (Array.isArray(value) && value.every((v) => typeof v === 'string' || typeof v === 'number')) return <span>{value.join(', ')}</span>
  return <pre className="overflow-x-auto rounded-md bg-muted p-2 text-xs">{JSON.stringify(value, null, 2)}</pre>
}

export function DefinitionList({ entries, className }: { entries: Array<[ReactNode, ReactNode]>; className?: string }) {
  if (entries.length === 0) return <p className="text-sm text-muted-foreground">Nothing here.</p>
  return (
    <dl className={cn('grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(10rem,1fr)_3fr]', className)}>
      {entries.map(([term, detail], i) => (
        <div key={i} className="contents">
          <dt className="font-medium text-muted-foreground sm:text-foreground">{term}</dt>
          <dd className="min-w-0 pb-2 sm:pb-0">{detail}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Entries for a definition list from a plain object, skipping the keys given. */
export function entriesOf(value: unknown, skip: Set<string> = new Set(), label: (key: string) => string = (k) => k): Array<[ReactNode, ReactNode]> {
  if (!isRecord(value)) return []
  return Object.entries(value)
    .filter(([key]) => !skip.has(key))
    .map(([key, v]) => [label(key), <ValueView key={key} value={v} />])
}

export function Field({ label, htmlFor, help, required, children }: { label: ReactNode; htmlFor?: string; help?: ReactNode; required?: boolean; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>
        {label}
        {required ? <span className="text-destructive" aria-hidden>*</span> : null}
      </Label>
      {children}
      {help == null ? null : <p className="text-xs text-muted-foreground">{help}</p>}
    </div>
  )
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <code className={cn('break-all font-mono text-xs', className)}>{children}</code>
}
