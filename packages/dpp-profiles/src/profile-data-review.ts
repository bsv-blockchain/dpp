import { datePrecisionOf } from './evidence-shapes.js'

export interface ProfileDataFinding {
  field: string
  outcome: 'invalid' | 'needs-review'
  reason: string
}

/**
 * Additional cross-field findings for the version 4 drafts, after validating
 * against their generated schema. An empty list is not a readiness result:
 * source evidence, applicability, access and lifecycle completeness remain
 * separate assessments. Historical versions are never reinterpreted here.
 */
export function reviewProfileData(profile: string, payload: Record<string, unknown>): ProfileDataFinding[] {
  const findings: ProfileDataFinding[] = []
  const add = (field: string, outcome: ProfileDataFinding['outcome'], reason: string) => findings.push({ field, outcome, reason })
  if (profile === 'battery@4') {
    const units: Record<string, string> = { powerAtStatusChange: 'W', resistanceAtStatusChange: 'Ω', roundTripEfficiencyAtStatusChange: '%', capacityFadeAtStatusChange: '%', powerFadeAtStatusChange: '%', resistanceIncreaseAtStatusChange: '%', efficiencyFadeAtStatusChange: '%' }
    if (payload.manufacturingDate != null) {
      const day = payload.manufacturingDate
      if (typeof day !== 'string' || datePrecisionOf(day) !== 'day') add('manufacturingDate', 'invalid', 'A supplied day must be a real calendar date.')
      else if (typeof payload.manufacturingMonth !== 'string' || day.slice(0, 7) !== payload.manufacturingMonth) add('manufacturingDate', 'invalid', 'The day and required month must describe the same manufacturing date.')
    }
    for (const key of ['powerAtStatusChange', 'resistanceAtStatusChange', 'roundTripEfficiencyAtStatusChange', 'capacityFadeAtStatusChange', 'powerFadeAtStatusChange', 'resistanceIncreaseAtStatusChange', 'efficiencyFadeAtStatusChange']) {
      const values = payload[key]
      if (!Array.isArray(values)) continue // Requiredness and shape belong to the other checks.
      for (let index = 0; index < values.length; index++) {
        const value = values[index] as Record<string, unknown> | null
        if (value == null || typeof value !== 'object') continue
        const subject = value.subject as { granularity?: unknown } | undefined
        if (subject?.granularity !== 'item') add(`${key}[${index}].subject`, 'invalid', 'An individual status-change measurement must identify an item.')
        if (value.unit !== units[key] || typeof value.value !== 'number' || !Number.isFinite(value.value)) add(`${key}[${index}].value`, 'invalid', `Supply a finite numeric measurement in ${units[key]}; no unit conversion or precision change is inferred.`)
        if (value.measuredAt == null || value.method == null || !Array.isArray(value.evidence) || value.evidence.length === 0) {
          add(`${key}[${index}]`, 'needs-review', 'Retain observation time, measurement method and supporting evidence before qualifying this individual value.')
        }
      }
    }
  } else if (profile === 'textile@4') {
    const components = Array.isArray(payload.components) ? payload.components : []
    const names = new Set(components.map(c => c?.component).filter((c): c is string => typeof c === 'string'))
    const totals = new Map<string, number>()
    for (const row of Array.isArray(payload.componentFibres) ? payload.componentFibres : []) {
      if (row == null || typeof row.component !== 'string' || typeof row.percent !== 'number' || !Number.isFinite(row.percent)) continue
      totals.set(row.component, (totals.get(row.component) ?? 0) + row.percent)
    }
    for (const [component, total] of totals) {
      if (!names.has(component)) add('componentFibres', 'needs-review', `Identify component ${component} in components before resolving its composition and any labelling exception.`)
      if (Math.abs(total - 100) > 1e-8) add('componentFibres', 'needs-review', `Declared shares for ${component} total ${total}%. Reconcile the component declaration and its basis; no analytical tolerance is inferred.`)
    }
  } else {
    throw new Error(`data review is not implemented for ${profile}; select its declared profile rules explicitly`)
  }
  return findings
}
