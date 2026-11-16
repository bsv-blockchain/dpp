// Small pieces the bound-profile pages share: the tier of a property, the
// outcome of a view, a validator's findings, and the warning that goes with
// anything public.
import type { ComponentProps, ReactNode } from 'react'
import { cn } from 'cn'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Mono, ToneBadge, type Tone } from '@/components/bits'
import type { Finding, ViewCheck, ViewStatus } from '@/lib/api'
import type { Tier } from '@/lib/bound/form-model'

export function TierBadge({ tier }: { tier: Tier }) {
  return tier === 'public' ? (
    <ToneBadge tone="warn" className="shrink-0">
      <span title="Written on chain. Anyone can read it, for good.">Public</span>
    </ToneBadge>
  ) : (
    <ToneBadge tone="neutral" className="shrink-0">
      <span title="Encrypted and kept off chain for the holder.">Restricted</span>
    </ToneBadge>
  )
}

const VIEW_TONES: Record<ViewStatus, { tone: Tone; label: string }> = {
  pass: { tone: 'pass', label: 'Pass' },
  fail: { tone: 'fail', label: 'Fail' },
  // A check that did not run to a decision is shown as that, never as a pass.
  'not-checked': { tone: 'unknown', label: 'Not checked' },
}

export function ViewBadge({ status }: { status: ViewStatus }) {
  const entry = VIEW_TONES[status] ?? VIEW_TONES['not-checked']
  return <ToneBadge tone={entry.tone}>{entry.label}</ToneBadge>
}

const STEP_LABELS: Record<string, string> = {
  envelope: 'The payload is the profile\'s envelope',
  binding: 'It declares the binding this reader holds',
  access: 'It carries public properties only',
  assembly: 'The two parts rejoin into one document',
  'json-schema': 'The document fits the profile\'s schema',
  'json-ld-expand': 'The document reads under the profile\'s contexts',
  shacl: 'The document keeps the profile\'s rules',
  'passport-identity': 'The document describes this passport\'s item',
}

const GENERIC_MESSAGES: Array<[RegExp, string]> = [
  [/^Less than \d+ values?$/i, 'A value is required here.'],
  [/^More than \d+ values?$/i, 'There are too many values here.'],
]

/** What a finding says, in a sentence: the rule's own message, or a plain one where the engine gave only a count. */
export function findingText(finding: Finding): string {
  const message = finding.message ?? ''
  const plain = GENERIC_MESSAGES.find(([pattern]) => pattern.test(message))?.[1]
  if (plain != null) return plain
  if (message !== '') return /[.!?]$/.test(message) ? message : `${message}.`
  return `The rule ${finding.constraint} does not hold.`
}

const severityTone = (severity: Finding['severity']): string => (severity === 'Violation' ? 'text-destructive' : 'text-amber-700 dark:text-amber-300')

/** Findings under the field they concern. A warning is reported and does not block. */
export function FindingLines({ findings, problems }: { findings?: Finding[]; problems?: string[] }) {
  if ((findings == null || findings.length === 0) && (problems == null || problems.length === 0)) return null
  return (
    <ul className="space-y-0.5 text-xs" role="alert">
      {(problems ?? []).map((problem, i) => (
        <li key={`p${i}`} className="text-destructive">
          {problem}
        </li>
      ))}
      {(findings ?? []).map((finding, i) => (
        <li key={`f${i}`} className={severityTone(finding.severity)}>
          {finding.severity === 'Violation' ? '' : `${finding.severity}: `}
          {findingText(finding)}
        </li>
      ))}
    </ul>
  )
}

/** One view's outcome with its steps and findings. The title says which view it is, so a public result is never read as a statement about restricted data. */
export function ViewPanel({ title, check, children }: { title: ReactNode; check: ViewCheck; children?: ReactNode }) {
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="flex items-center gap-2">
          <ViewBadge status={check.status} />
          {check.cause == null ? null : <Mono className="text-muted-foreground">{check.cause}</Mono>}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">{check.summary}</p>
      {children}
      {check.steps.length === 0 ? null : (
        <ul className="divide-y rounded-md border text-sm">
          {check.steps.map((step, i) => (
            <li key={`${step.step}${i}`} className="space-y-1 p-2">
              <div className="flex items-center justify-between gap-3">
                <span>{STEP_LABELS[step.step] ?? step.step}</span>
                <ViewBadge status={step.status} />
              </div>
              {step.messages.length === 0 ? null : (
                <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                  {step.messages.map((message, j) => (
                    <li key={j}>{message}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      {check.findings.length === 0 ? null : (
        <div className="space-y-1">
          <p className="text-xs font-medium">Findings</p>
          <ul className="space-y-1 text-xs">
            {check.findings.map((finding, i) => (
              <li key={i} className={severityTone(finding.severity)}>
                {finding.severity}: {findingText(finding)} {finding.property == null ? null : <Mono className="text-muted-foreground">{finding.pointer ?? finding.property}</Mono>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {check.withheld.length === 0 ? null : (
        <div className="space-y-1">
          <p className="text-xs font-medium">Not decided from this view</p>
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
            {check.withheld.map((rule, i) => (
              <li key={i}>
                The rule on <Mono>{rule.property}</Mono> needs a restricted property.
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export function PublicDataWarning({ split }: { split: boolean }) {
  return (
    <Alert className="border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
      <AlertTitle>Public data is permanent and world-readable</AlertTitle>
      <AlertDescription className="text-current">
        <p>
          {split ? 'Every property marked Public is written to a public blockchain.' : 'This profile makes no split: the whole document is written to a public blockchain.'} Anyone can read it, for good, and it cannot be withdrawn or redacted.
        </p>
        {split ? <p>The split is by property, not by value. A restricted value that you repeat inside a public property, such as a name in a description or a link to a private file, is published with that property.</p> : null}
      </AlertDescription>
    </Alert>
  )
}

/** A plain select, for forms with many of them. An empty choice writes nothing. */
export function NativeSelect({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-2 py-1 text-base shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30',
        className
      )}
      {...props}
    >
      {children}
    </select>
  )
}
