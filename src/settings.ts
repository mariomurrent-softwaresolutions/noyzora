import { useSyncExternalStore } from 'react'

/** User settings, kept in localStorage so the visualizer page and the monitor page share them. */

const KEY = 'noyzora.soundThresholdDb'

export const THRESHOLD_MIN = -60
export const THRESHOLD_MAX = -20
export const THRESHOLD_DEFAULT = -42

const clamp = (v: number) => Math.min(THRESHOLD_MAX, Math.max(THRESHOLD_MIN, Math.round(v)))

function read(): number {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (raw !== null) {
      const n = Number(raw)
      if (Number.isFinite(n)) return clamp(n)
    }
  } catch {
    /* storage unavailable (private mode etc.): fall back to the default */
  }
  return THRESHOLD_DEFAULT
}

let current = read()
const listeners = new Set<() => void>()

/** Level (dBFS) the input has to exceed before the visualizer starts moving. */
export function setThresholdDb(value: number) {
  current = clamp(value)
  try {
    window.localStorage.setItem(KEY, String(current))
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l())
}

function subscribe(callback: () => void) {
  listeners.add(callback)
  // pick up changes made in another tab
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      current = read()
      callback()
    }
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(callback)
    window.removeEventListener('storage', onStorage)
  }
}

export function useThresholdDb(): number {
  return useSyncExternalStore(subscribe, () => current)
}
