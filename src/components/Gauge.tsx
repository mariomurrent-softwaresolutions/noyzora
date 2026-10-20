import type { LevelZone } from '../audio/meterMath'
import { ZONE_COLOR } from './zoneColors'

interface Props {
  /** Estimated dB(A) */
  value: number
  min: number
  max: number
  caution: number
  alarm: number
  zone: LevelZone
  /** Whether a reading exists (microphone on) */
  active: boolean
}

const CX = 200
const CY = 190
const R = 150
const START = 135 // degrees, 0 = 3 o'clock, clockwise; 135 = bottom left
const SWEEP = 270

const polar = (deg: number) => {
  const rad = (deg * Math.PI) / 180
  return { x: CX + R * Math.cos(rad), y: CY + R * Math.sin(rad) }
}

function arcPath(from: number, to: number): string {
  const a = polar(from)
  const b = polar(to)
  const large = to - from > 180 ? 1 : 0
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${R} ${R} 0 ${large} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`
}

export default function Gauge({ value, min, max, caution, alarm, zone, active }: Props) {
  const angleFor = (db: number) => START + SWEEP * Math.min(1, Math.max(0, (db - min) / (max - min)))
  const aCaution = angleFor(caution)
  const aAlarm = angleFor(alarm)
  const aValue = angleFor(value)
  const end = START + SWEEP
  const tip = polar(aValue)
  const left = polar(START)
  const right = polar(end)

  const label = !active ? '–' : value < min ? `<${min}` : String(Math.round(value))

  return (
    <svg className="cls-gauge" viewBox="0 0 400 336" role="img" aria-label={active ? `${label} decibels A` : 'No reading'}>
      {/* zone track */}
      <path d={arcPath(START, aCaution)} stroke={ZONE_COLOR.calm} className="cls-track" />
      <path d={arcPath(aCaution, aAlarm)} stroke={ZONE_COLOR.caution} className="cls-track" />
      <path d={arcPath(aAlarm, end)} stroke={ZONE_COLOR.alarm} className="cls-track" />

      {/* current level */}
      {active && aValue > START + 0.5 && (
        <>
          <path d={arcPath(START, aValue)} stroke={ZONE_COLOR[zone]} className="cls-value-arc" />
          <circle cx={tip.x} cy={tip.y} r="14" fill="#fff" className="cls-knob" />
        </>
      )}

      <text x={left.x} y={left.y + 30} textAnchor="middle" className="cls-tick">
        {min}
      </text>
      <text x={right.x} y={right.y + 30} textAnchor="middle" className="cls-tick">
        {max}
      </text>

      <text x={CX} y={CY + 36} textAnchor="middle" className="cls-number" fill={active ? ZONE_COLOR[zone] : '#64748b'}>
        {label}
      </text>
      <text x={CX} y={CY + 78} textAnchor="middle" className="cls-unit">
        dB(A)
      </text>
    </svg>
  )
}
