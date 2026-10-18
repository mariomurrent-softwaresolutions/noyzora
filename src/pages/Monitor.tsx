import LevelMeter from '../components/LevelMeter'
import Waveform from '../components/Waveform'
import { useMicrophone } from '../hooks/useMicrophone'
import { Link } from '../router'
import { THRESHOLD_DEFAULT, THRESHOLD_MAX, THRESHOLD_MIN, setThresholdDb, useThresholdDb } from '../settings'

export default function Monitor() {
  const { status, error, db, peakDb, analyser, start, stop } = useMicrophone()
  const threshold = useThresholdDb()
  const listening = status === 'listening'

  return (
    <main className="app">
      <h1>Noyzora</h1>
      <p className="subtitle">Live microphone waveform and loudness</p>

      <section className="card">
        <Waveform analyser={analyser} />
        <LevelMeter db={db} peakDb={peakDb} thresholdDb={threshold} />
      </section>

      <div className="controls">
        <button onClick={listening ? stop : start} disabled={status === 'requesting'} className={listening ? 'stop' : 'start'}>
          {status === 'requesting' ? 'Waiting for permission…' : listening ? 'Stop' : 'Start listening'}
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      <section className="card settings">
        <h2>Settings</h2>
        <label htmlFor="threshold">
          <span>Visualizer sound threshold</span>
          <strong>{threshold} dBFS</strong>
        </label>
        <input
          id="threshold"
          type="range"
          min={THRESHOLD_MIN}
          max={THRESHOLD_MAX}
          step={1}
          value={threshold}
          onChange={(e) => setThresholdDb(Number(e.target.value))}
        />
        <div className="range-scale">
          <span>{THRESHOLD_MIN} · more sensitive</span>
          <span>less sensitive · {THRESHOLD_MAX}</span>
        </div>
        <p className="setting-help">
          The visualizer starts reacting a little below this level and is fully awake a little above it; when it's
          quieter, it shows its calm idle wave. The dashed line on the level meter above shows where it sits. Start listening, stay quiet, and set it
          just above your background noise.
        </p>
        <button className="link-btn" onClick={() => setThresholdDb(THRESHOLD_DEFAULT)}>
          Reset to {THRESHOLD_DEFAULT} dBFS
        </button>
      </section>

      <p className="nav-row">
        <Link to="/visualizer" className="nav-link">
          Open full-screen visualizer →
        </Link>
      </p>
      <p className="hint">
        dBFS is relative to digital full scale (0 = loudest the input can represent). It is not calibrated sound
        pressure (dB SPL).
      </p>
    </main>
  )
}
