import { useSyncExternalStore } from 'react'

/** User settings, kept in localStorage so all pages share them. */

interface NumberSetting {
  readonly min: number
  readonly max: number
  readonly def: number
  /** React hook returning the current value. */
  use: () => number
  set: (value: number) => void
}

function createNumberSetting(key: string, def: number, min: number, max: number): NumberSetting {
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v)))

  const read = (): number => {
    try {
      const raw = window.localStorage.getItem(key)
      if (raw !== null) {
        const n = Number(raw)
        if (Number.isFinite(n)) return clamp(n)
      }
    } catch {
      /* storage unavailable (private mode etc.): fall back to the default */
    }
    return def
  }

  let current = read()
  const listeners = new Set<() => void>()

  const set = (value: number) => {
    current = clamp(value)
    try {
      window.localStorage.setItem(key, String(current))
    } catch {
      /* ignore */
    }
    listeners.forEach((l) => l())
  }

  const subscribe = (callback: () => void) => {
    listeners.add(callback)
    // pick up changes made in another tab
    const onStorage = (e: StorageEvent) => {
      if (e.key === key) {
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

  return { min, max, def, set, use: () => useSyncExternalStore(subscribe, () => current) }
}

/** Visualizer: input level (dBFS) around which the animation wakes up. */
export const soundThreshold = createNumberSetting('noyzora.soundThresholdDb', -42, -60, -20)

/** Classroom meter: estimated dB(A) where "getting loud" starts / where it is "too loud". */
export const cautionLevel = createNumberSetting('noyzora.classroom.cautionDb', 60, 30, 100)
export const alarmLevel = createNumberSetting('noyzora.classroom.alarmDb', 70, 35, 110)

/** Classroom meter: added to the A-weighted dBFS reading to estimate dB(A). Set by calibration. */
export const calibrationOffset = createNumberSetting('noyzora.classroom.offsetDb', 100, 40, 140)

// names used by the monitor and visualizer pages
export const THRESHOLD_MIN = soundThreshold.min
export const THRESHOLD_MAX = soundThreshold.max
export const THRESHOLD_DEFAULT = soundThreshold.def
export const setThresholdDb = soundThreshold.set
export const useThresholdDb = soundThreshold.use
