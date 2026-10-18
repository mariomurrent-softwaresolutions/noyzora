import { useCallback, useEffect, useRef, useState } from 'react'

export type MicStatus = 'idle' | 'requesting' | 'listening' | 'denied' | 'error'

export const MIN_DB = -90

/** Convert a linear amplitude (0..1) to dBFS, clamped at MIN_DB. */
export function toDb(amplitude: number): number {
  if (amplitude <= 0) return MIN_DB
  return Math.max(MIN_DB, 20 * Math.log10(amplitude))
}

interface MicState {
  status: MicStatus
  error: string | null
  /** Current RMS level in dBFS (0 = digital full scale, negative below that). */
  db: number
  /** Peak level held for ~1.5s, in dBFS. */
  peakDb: number
  analyser: AnalyserNode | null
}

const initial: MicState = {
  status: 'idle',
  error: null,
  db: MIN_DB,
  peakDb: MIN_DB,
  analyser: null,
}

/**
 * Opens the microphone, feeds it into an AnalyserNode and measures loudness.
 * The analyser is returned so visualisations can read the raw waveform.
 */
export function useMicrophone() {
  const [state, setState] = useState<MicState>(initial)

  const ctxRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number>(0)

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    void ctxRef.current?.close()
    ctxRef.current = null
    setState(initial)
  }, [])

  const start = useCallback(async () => {
    if (ctxRef.current) return
    if (!navigator.mediaDevices?.getUserMedia) {
      setState({ ...initial, status: 'error', error: 'Microphone access is not supported (needs HTTPS or localhost).' })
      return
    }

    setState({ ...initial, status: 'requesting' })

    try {
      // Turn off processing so the meter reflects the real input level.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
      const ctx = new AudioContext()
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0
      source.connect(analyser) // intentionally not connected to destination (no feedback)

      streamRef.current = stream
      ctxRef.current = ctx
      setState({ ...initial, status: 'listening', analyser })

      const buffer = new Float32Array(analyser.fftSize)
      let smoothed = MIN_DB
      let peak = MIN_DB
      let peakAt = 0
      let lastUi = 0

      const tick = (now: number) => {
        analyser.getFloatTimeDomainData(buffer)
        let sum = 0
        for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i]
        const instant = toDb(Math.sqrt(sum / buffer.length))

        // Fast attack, slower release, so the number is readable.
        smoothed = instant > smoothed ? instant : smoothed * 0.9 + instant * 0.1

        if (smoothed >= peak || now - peakAt > 1500) {
          peak = smoothed
          peakAt = now
        }

        // Update React state ~20x/second, not every frame.
        if (now - lastUi > 50) {
          lastUi = now
          setState((s) => ({ ...s, db: smoothed, peakDb: peak }))
        }
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    } catch (e) {
      const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError')
      setState({
        ...initial,
        status: denied ? 'denied' : 'error',
        error: denied ? 'Microphone permission was denied.' : e instanceof Error ? e.message : 'Unknown error',
      })
    }
  }, [])

  useEffect(() => stop, [stop])

  return { ...state, start, stop }
}
