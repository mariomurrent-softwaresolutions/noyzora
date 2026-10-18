import { MIN_DB } from '../hooks/useMicrophone'

interface Props {
  db: number
  peakDb: number
}

const FLOOR = -60 // bar starts here
const toPercent = (db: number) => Math.min(100, Math.max(0, ((db - FLOOR) / -FLOOR) * 100))

function label(db: number): string {
  if (db <= -60) return 'Silent'
  if (db <= -40) return 'Quiet'
  if (db <= -20) return 'Normal'
  if (db <= -6) return 'Loud'
  return 'Very loud'
}

export default function LevelMeter({ db, peakDb }: Props) {
  const silent = db <= MIN_DB + 0.5
  return (
    <div className="meter">
      <div className="meter-readout">
        <span className="meter-value">{silent ? '−∞' : db.toFixed(1)}</span>
        <span className="meter-unit">dBFS</span>
        <span className="meter-label">{label(db)}</span>
      </div>

      <div className="meter-bar" role="meter" aria-valuemin={FLOOR} aria-valuemax={0} aria-valuenow={Math.round(db)}>
        <div className="meter-cover" style={{ width: `${100 - toPercent(db)}%` }} />
        <div className="meter-peak" style={{ left: `${toPercent(peakDb)}%` }} />
      </div>

      <div className="meter-scale">
        {[-60, -48, -36, -24, -12, 0].map((v) => (
          <span key={v}>{v}</span>
        ))}
      </div>
      <div className="meter-peak-text">Peak {peakDb <= MIN_DB + 0.5 ? '−∞' : peakDb.toFixed(1)} dBFS</div>
    </div>
  )
}
