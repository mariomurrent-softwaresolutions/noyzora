import { useEffect, useState } from 'react'
import FancyVisualizer, { type VizMode } from '../components/FancyVisualizer'
import { useMicrophone } from '../hooks/useMicrophone'
import { Link } from '../router'
import { useThresholdDb } from '../settings'
import './visualizer.css'

const MODES: { id: VizMode; label: string }[] = [
  { id: 'ridge', label: 'Spectrum' },
  { id: 'aurora', label: 'Aurora' },
  { id: 'orbit', label: 'Orbit' },
]

function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
  else void document.documentElement.requestFullscreen().catch(() => undefined)
}

/** Route /visualizer: nothing but the waveform, full screen. */
export default function Visualizer() {
  const { status, error, analyser, start, stop } = useMicrophone()
  const thresholdDb = useThresholdDb()
  const [mode, setMode] = useState<VizMode>('ridge')
  const [uiVisible, setUiVisible] = useState(true)

  const listening = status === 'listening'
  const requesting = status === 'requesting'
  const uiHidden = listening && !uiVisible

  // Errors are not shown on this screen, only logged.
  useEffect(() => {
    if (error) console.error('[visualizer] microphone:', error)
  }, [error])

  // Start listening as soon as the page opens.
  useEffect(() => {
    void start()
  }, [start])

  // Controls fade out after 3s without input while listening.
  useEffect(() => {
    let timer = 0
    const show = () => {
      setUiVisible(true)
      window.clearTimeout(timer)
      if (listening) timer = window.setTimeout(() => setUiVisible(false), 3000)
    }
    show()
    window.addEventListener('mousemove', show)
    window.addEventListener('pointerdown', show)
    window.addEventListener('keydown', show)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('mousemove', show)
      window.removeEventListener('pointerdown', show)
      window.removeEventListener('keydown', show)
    }
  }, [listening])

  // Keyboard shortcuts: space = start/stop, M = switch look, F = fullscreen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === ' ') {
        e.preventDefault()
        if (listening) stop()
        else void start()
      } else if (e.key === 'm' || e.key === 'M') {
        setMode((m) => MODES[(MODES.findIndex((x) => x.id === m) + 1) % MODES.length].id)
      } else if (e.key === 'f' || e.key === 'F') {
        toggleFullscreen()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [listening, start, stop])

  return (
    <div
      className={`viz-root${uiHidden ? ' ui-hidden' : ''}${listening ? '' : ' idle'}`}
      onClick={(e) => {
        // click anywhere (except links/buttons) starts listening
        if (listening || requesting || (e.target as HTMLElement).closest('a, button')) return
        void start()
      }}
    >
      <FancyVisualizer analyser={analyser} mode={mode} thresholdDb={thresholdDb} />

      <Link to="/" className="viz-chip viz-ui viz-back">
        ← Monitor
      </Link>

      {!listening && (
        <div className="viz-hero">
          <h1>Noyzora</h1>
        </div>
      )}

      {listening && (
        <div className="viz-bar viz-ui">
          <div className="viz-seg" role="group" aria-label="Look">
            {MODES.map((m) => (
              <button key={m.id} aria-pressed={mode === m.id} onClick={() => setMode(m.id)}>
                {m.label}
              </button>
            ))}
          </div>
          <button className="viz-btn" onClick={toggleFullscreen}>
            Fullscreen
          </button>
          <button className="viz-btn viz-stop" onClick={stop}>
            Stop
          </button>
        </div>
      )}
    </div>
  )
}
