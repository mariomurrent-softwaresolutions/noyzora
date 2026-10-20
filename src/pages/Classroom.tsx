import { useEffect, useMemo, useRef, useState } from 'react'
import {
  MIN_DB,
  classifyLevel,
  dbToPower,
  equivalentLevel,
  powerToDb,
  smoothingCoefficient,
  type LevelZone,
} from '../audio/meterMath'
import Gauge from '../components/Gauge'
import HistoryChart from '../components/HistoryChart'
import { useMicrophone } from '../hooks/useMicrophone'
import { useWakeLock } from '../hooks/useWakeLock'
import { Link } from '../router'
import { alarmLevel, calibrationOffset, cautionLevel } from '../settings'
import './classroom.css'

const RANGE_MIN = 30
const RANGE_MAX = 100
/** The big number is a ~1 s average so it is calm enough to read. */
const SLOW_TAU_MS = 1000
const HISTORY_SECONDS = 600
const CHART_SECONDS = 300
/** Too loud for this long before the screen starts flashing. */
const ALARM_HOLD_MS = 2000

const ZONE_TEXT: Record<LevelZone, string> = {
  calm: 'Nice and quiet',
  caution: 'Getting loud',
  alarm: 'Too loud!',
}

/** Classroom noise meter: route /classroom. Made to be shown on a projector. */
export default function Classroom() {
  const { status, error, db, start, stop } = useMicrophone({ aWeighted: true })
  const offset = calibrationOffset.use()
  const caution = cautionLevel.use()
  const alarm = alarmLevel.use()

  const [held, setHeld] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [reference, setReference] = useState('')
  /** A-weighted dBFS, 1 s average (before calibration offset) */
  const [slowDb, setSlowDb] = useState(MIN_DB)
  /** A-weighted dBFS, one value per second */
  const [history, setHistory] = useState<number[]>([])
  const [alarmActive, setAlarmActive] = useState(false)

  const listening = status === 'listening'
  const running = listening && !held

  useWakeLock(listening)

  // Escape closes the settings panel
  useEffect(() => {
    if (!panelOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPanelOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [panelOpen])

  // start listening as soon as the page opens
  useEffect(() => {
    void start()
  }, [start])

  // 1 s average of the fast-weighted level
  const slowPower = useRef(0)
  const lastTs = useRef(0)
  useEffect(() => {
    if (!listening) {
      slowPower.current = 0
      lastTs.current = 0
      setSlowDb(MIN_DB)
      return
    }
    if (held) {
      lastTs.current = 0
      return
    }
    const now = performance.now()
    const dt = lastTs.current ? now - lastTs.current : 0
    lastTs.current = now
    const power = dbToPower(db)
    if (slowPower.current === 0) slowPower.current = power
    else slowPower.current += (power - slowPower.current) * smoothingCoefficient(dt, SLOW_TAU_MS)
    setSlowDb(powerToDb(slowPower.current))
  }, [db, listening, held])

  // one history point per second
  const slowRef = useRef(slowDb)
  useEffect(() => {
    slowRef.current = slowDb
  }, [slowDb])
  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => {
      setHistory((h) => {
        const next = [...h, slowRef.current]
        return next.length > HISTORY_SECONDS ? next.slice(next.length - HISTORY_SECONDS) : next
      })
    }, 1000)
    return () => window.clearInterval(id)
  }, [running])
  useEffect(() => {
    if (!listening) setHistory([])
  }, [listening])

  const shown = slowDb + offset // estimated dB(A)
  const zone = classifyLevel(shown, caution, alarm)

  // flash only after it has been too loud for a while
  const overSince = useRef<number | null>(null)
  useEffect(() => {
    if (zone !== 'alarm' || !running) {
      overSince.current = null
      setAlarmActive(false)
      return
    }
    if (overSince.current === null) overSince.current = performance.now()
    const id = window.setInterval(() => {
      if (overSince.current !== null && performance.now() - overSince.current >= ALARM_HOLD_MS) setAlarmActive(true)
    }, 250)
    return () => window.clearInterval(id)
  }, [zone, running])

  const chartValues = useMemo(() => history.map((v) => v + offset), [history, offset])
  const stats = useMemo(() => {
    const last5 = history.slice(-CHART_SECONDS)
    const last1 = history.slice(-60)
    return {
      average: last5.length ? equivalentLevel(last5) + offset : null,
      loudest: last1.length ? Math.max(...last1) + offset : null,
    }
  }, [history, offset])

  const fmt = (v: number | null) => (v === null ? '–' : `${Math.round(Math.max(RANGE_MIN, v))} dB(A)`)

  const calibrate = () => {
    const ref = Number(reference)
    if (!listening || !Number.isFinite(ref) || reference.trim() === '') return
    calibrationOffset.set(ref - slowDb)
    setReference('')
  }

  const useRoomAsQuiet = () => {
    const base = Math.round(shown)
    cautionLevel.set(base + 6)
    alarmLevel.set(base + 14)
  }

  const label = !listening ? 'Microphone off' : held ? `${ZONE_TEXT[zone]} (held)` : ZONE_TEXT[zone]

  return (
    <div className={`cls-root zone-${zone}${alarmActive ? ' alarm' : ''}`}>
      <header className="cls-top">
        <Link to="/" className="cls-btn cls-ghost">
          ← Monitor
        </Link>
        <h1>Classroom noise level</h1>
        <div className="cls-actions">
          {listening ? (
            <button className="cls-btn" onClick={stop}>
              Stop
            </button>
          ) : (
            <button className="cls-btn cls-primary" onClick={() => void start()} disabled={status === 'requesting'}>
              {status === 'requesting' ? 'Waiting…' : 'Start microphone'}
            </button>
          )}
          <button className="cls-btn" aria-pressed={held} disabled={!listening} onClick={() => setHeld((h) => !h)}>
            {held ? 'Resume' : 'Hold'}
          </button>
          <button className="cls-btn" aria-expanded={panelOpen} onClick={() => setPanelOpen((o) => !o)}>
            Settings
          </button>
        </div>
      </header>

      <main className="cls-main">
        <Gauge
          value={shown}
          min={RANGE_MIN}
          max={RANGE_MAX}
          caution={caution}
          alarm={alarm}
          zone={zone}
          active={listening}
        />
        <div className="cls-zone-label" aria-live="polite">
          {label}
        </div>

        <div className="cls-stats">
          <div>
            <span>Average, last 5 min</span>
            <strong>{fmt(stats.average)}</strong>
          </div>
          <div>
            <span>Loudest, last minute</span>
            <strong>{fmt(stats.loudest)}</strong>
          </div>
        </div>

        <HistoryChart
          values={chartValues}
          min={RANGE_MIN}
          max={RANGE_MAX}
          caution={caution}
          alarm={alarm}
          seconds={CHART_SECONDS}
        />
        {error && <p className="cls-error">{error}</p>}
      </main>

      {panelOpen && (
        <aside className="cls-panel" aria-label="Settings">
          <div className="cls-panel-head">
            <h2>Settings</h2>
            <button className="cls-btn" onClick={() => setPanelOpen(false)}>
              Close
            </button>
          </div>

          <label htmlFor="caution">
            <span>"Getting loud" from</span>
            <strong>{caution} dB(A)</strong>
          </label>
          <input
            id="caution"
            type="range"
            min={cautionLevel.min}
            max={cautionLevel.max}
            value={caution}
            onChange={(e) => {
              const v = Number(e.target.value)
              cautionLevel.set(v)
              if (v >= alarm) alarmLevel.set(v + 1)
            }}
          />

          <label htmlFor="alarm">
            <span>"Too loud" from</span>
            <strong>{alarm} dB(A)</strong>
          </label>
          <input
            id="alarm"
            type="range"
            min={alarmLevel.min}
            max={alarmLevel.max}
            value={alarm}
            onChange={(e) => alarmLevel.set(Math.max(Number(e.target.value), caution + 1))}
          />

          <button className="cls-btn" disabled={!listening} onClick={useRoomAsQuiet}>
            Use the current room as "quiet"
          </button>
          <p className="cls-help">
            Sets "getting loud" 6 dB and "too loud" 14 dB above what the room measures right now. Press it while the
            room is quiet.
          </p>

          <h3>Calibration</h3>
          <p className="cls-help">
            Without calibration the number is only an estimate: microphones differ a lot. Hold a sound-meter app (set to
            dB(A)) next to this microphone, type its reading and press Calibrate. Current offset:{' '}
            <strong>{offset} dB</strong>.
          </p>
          <div className="cls-row">
            <input
              type="number"
              inputMode="decimal"
              placeholder="Reference dB(A)"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && calibrate()}
            />
            <button className="cls-btn cls-primary" disabled={!listening || reference.trim() === ''} onClick={calibrate}>
              Calibrate
            </button>
          </div>
          <button className="cls-link" onClick={() => calibrationOffset.set(calibrationOffset.def)}>
            Reset calibration
          </button>
          <p className="cls-help">
            Readings are A-weighted like a sound level meter. A laptop microphone is good for "quiet or loud", not for
            official measurements.
          </p>
        </aside>
      )}
    </div>
  )
}
