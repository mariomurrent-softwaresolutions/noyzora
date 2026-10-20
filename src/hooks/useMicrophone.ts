import { useCallback, useEffect, useRef, useState } from 'react'
import { createAWeighting } from '../audio/aWeighting'
import { MIN_DB, meanSquare, powerToDb, smoothingCoefficient } from '../audio/meterMath'

export { MIN_DB }

export type MicStatus = 'idle' | 'requesting' | 'listening' | 'denied' | 'error'

export interface MicOptions {
  /** Weight the level the way a sound level meter does (dB(A)). The analyser stays unweighted. */
  aWeighted?: boolean
}

/** "Fast" time weighting of a sound level meter. */
const LEVEL_TAU_MS = 125
const PEAK_HOLD_MS = 1500
const UI_INTERVAL_MS = 50

interface MicState {
  status: MicStatus
  error: string | null
  /** Current level in dBFS (0 = digital full scale, negative below that). */
  db: number
  /** Peak level held for ~1.5s, in dBFS. */
  peakDb: number
  /** Unweighted signal, for visualisations. */
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
 * Opens the microphone and measures loudness. The returned analyser carries the raw
 * (unweighted) signal so visualisations can read the waveform and spectrum.
 */
export function useMicrophone(options: MicOptions = {}) {
  const [state, setState] = useState<MicState>(initial)

  const ctxRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number>(0)
  // bumped on every start/stop so a stale async start can detect it was cancelled
  const genRef = useRef(0)
  const removeListenersRef = useRef<(() => void) | null>(null)
  const aWeightedRef = useRef(options.aWeighted ?? false)

  useEffect(() => {
    aWeightedRef.current = options.aWeighted ?? false
  }, [options.aWeighted])

  const stop = useCallback(() => {
    genRef.current++
    removeListenersRef.current?.()
    removeListenersRef.current = null
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
    const gen = ++genRef.current

    try {
      // Turn off processing so the meter reflects the real input level.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
      if (gen !== genRef.current) {
        // stop() (or a newer start) happened while the permission prompt was open
        stream.getTracks().forEach((t) => t.stop())
        return
      }

      const ctx = new AudioContext()
      // Browsers keep an AudioContext suspended until the user interacts with the page.
      const unlock = () => {
        if (ctx.state === 'suspended') ctx.resume().catch(() => undefined)
      }
      unlock()
      window.addEventListener('pointerdown', unlock)
      window.addEventListener('keydown', unlock)

      // A device that is unplugged or revoked ends its track.
      const track = stream.getAudioTracks()[0]
      const onEnded = () => {
        if (gen !== genRef.current) return
        stop()
        setState({ ...initial, status: 'error', error: 'The microphone was disconnected.' })
      }
      track?.addEventListener('ended', onEnded)
      removeListenersRef.current = () => {
        window.removeEventListener('pointerdown', unlock)
        window.removeEventListener('keydown', unlock)
        track?.removeEventListener('ended', onEnded)
      }

      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0

      // Visual analyser: raw signal. Level meter: optionally A-weighted.
      source.connect(analyser)
      let meter = analyser
      if (aWeightedRef.current) {
        const chain = createAWeighting(ctx)
        meter = ctx.createAnalyser()
        meter.fftSize = 2048
        meter.smoothingTimeConstant = 0
        source.connect(chain.input)
        chain.output.connect(meter)
      }
      // intentionally nothing is connected to ctx.destination (no feedback)

      streamRef.current = stream
      ctxRef.current = ctx
      setState({ ...initial, status: 'listening', analyser })

      const buffer = new Float32Array(meter.fftSize)
      let smoothedPower = 0
      let last = performance.now()
      let peak = MIN_DB
      let peakAt = 0
      let lastUi = 0

      const tick = (now: number) => {
        meter.getFloatTimeDomainData(buffer)
        smoothedPower += (meanSquare(buffer) - smoothedPower) * smoothingCoefficient(now - last, LEVEL_TAU_MS)
        last = now
        const db = powerToDb(smoothedPower)

        if (db >= peak || now - peakAt > PEAK_HOLD_MS) {
          peak = db
          peakAt = now
        }

        // Update React state ~20x/second, not every frame.
        if (now - lastUi > UI_INTERVAL_MS) {
          lastUi = now
          setState((s) => ({ ...s, db, peakDb: peak }))
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
  }, [stop])

  useEffect(() => stop, [stop])

  return { ...state, start, stop }
}
