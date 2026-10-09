// One hook for "load this when these change": data, error, loading and a
// reload, with a stale answer from an earlier run never overwriting a newer one.
import { useCallback, useEffect, useState } from 'react'

export interface Loaded<T> {
  data: T | undefined
  error: Error | undefined
  loading: boolean
  reload: () => void
  setData: (data: T) => void
}

export const toError = (cause: unknown): Error => (cause instanceof Error ? cause : new Error(String(cause)))

export function useLoad<T>(load: () => Promise<T>, deps: readonly unknown[]): Loaded<T> {
  const [data, setData] = useState<T>()
  const [error, setError] = useState<Error>()
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(undefined)
    load().then(
      (result) => {
        if (cancelled) return
        setData(result)
        setLoading(false)
      },
      (cause: unknown) => {
        if (cancelled) return
        setError(toError(cause))
        setLoading(false)
      }
    )
    return () => {
      cancelled = true
    }
    // The caller names the inputs; the loader itself is recreated on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { data, error, loading, reload, setData }
}
