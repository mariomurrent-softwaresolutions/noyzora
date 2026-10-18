import LevelMeter from './components/LevelMeter'
import Waveform from './components/Waveform'
import { useMicrophone } from './hooks/useMicrophone'

export default function App() {
  const { status, error, db, peakDb, analyser, start, stop } = useMicrophone()
  const listening = status === 'listening'

  return (
    <main className="app">
      <h1>Noyzora</h1>
      <p className="subtitle">Live microphone waveform and loudness</p>

      <section className="card">
        <Waveform analyser={analyser} />
        <LevelMeter db={db} peakDb={peakDb} />
      </section>

      <div className="controls">
        <button onClick={listening ? stop : start} disabled={status === 'requesting'} className={listening ? 'stop' : 'start'}>
          {status === 'requesting' ? 'Waiting for permission…' : listening ? 'Stop' : 'Start listening'}
        </button>
      </div>

      {error && <p className="error">{error}</p>}
      <p className="hint">
        dBFS is relative to digital full scale (0 = loudest the input can represent). It is not calibrated sound
        pressure (dB SPL).
      </p>
    </main>
  )
}
