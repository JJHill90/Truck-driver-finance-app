import { useCallback, useEffect, useState } from 'react'

/** A useState-like hook that persists JSON-serializable state to localStorage. */
export function useLocalStorage<T>(
  key: string,
  initialValue: T,
): [T, (value: T | ((prev: T) => T)) => void] {
  const [stored, setStored] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : initialValue
    } catch {
      return initialValue
    }
  })

  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      setStored((prev) => (value instanceof Function ? value(prev) : value))
    },
    [],
  )

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(stored))
    } catch {
      // Ignore write errors (e.g. private mode / quota).
    }
  }, [key, stored])

  return [stored, setValue]
}
