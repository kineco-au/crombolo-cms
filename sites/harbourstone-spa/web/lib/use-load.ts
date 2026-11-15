import { useEffect, useState } from 'react'

/** What `load` answers, read again whenever `key` changes; undefined until it has. */
export function useLoad<T>(key: string, load: () => Promise<T>): T | undefined {
  const [loaded, setLoaded] = useState<{ key: string; value: T }>()
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key says when to read again.
  useEffect(() => {
    let current = true
    load().then(
      (value) => {
        if (current) setLoaded({ key, value })
      },
      () => undefined,
    )
    return () => {
      current = false
    }
  }, [key])
  return loaded?.key === key ? loaded.value : undefined
}
