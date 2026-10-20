import { useEffect, useRef } from 'react'
import { classifyLevel } from '../audio/meterMath'
import { ZONE_COLOR } from './zoneColors'

interface Props {
  /** Estimated dB(A), one value per second, oldest first */
  values: number[]
  min: number
  max: number
  caution: number
  alarm: number
  /** Width of the chart in seconds */
  seconds?: number
  height?: number
}

/** Level over the last few minutes, coloured by zone, with the two thresholds as dashed lines. */
export default function HistoryChart({ values, min, max, caution, alarm, seconds = 300, height = 150 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const draw = () => {
      const dpr = window.devicePixelRatio || 1
      const W = canvas.clientWidth
      const H = height
      canvas.width = Math.floor(W * dpr)
      canvas.height = Math.floor(H * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)

      const padL = 34
      const padR = 8
      const padT = 8
      const padB = 8
      const plotW = W - padL - padR
      const plotH = H - padT - padB
      const y = (db: number) => padT + plotH * (1 - Math.min(1, Math.max(0, (db - min) / (max - min))))
      const x = (i: number, n: number) => padL + plotW * (1 - (n - 1 - i) / (seconds - 1))

      ctx.font = '11px system-ui, sans-serif'
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'right'

      // grid + labels
      ctx.lineWidth = 1
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.15)'
      ctx.fillStyle = '#94a3b8'
      for (let db = Math.ceil(min / 10) * 10; db <= max; db += 10) {
        ctx.beginPath()
        ctx.moveTo(padL, y(db))
        ctx.lineTo(W - padR, y(db))
        ctx.stroke()
        ctx.fillText(String(db), padL - 6, y(db))
      }

      // thresholds
      ctx.setLineDash([6, 5])
      for (const [db, color] of [
        [caution, ZONE_COLOR.caution],
        [alarm, ZONE_COLOR.alarm],
      ] as const) {
        ctx.strokeStyle = color
        ctx.globalAlpha = 0.7
        ctx.beginPath()
        ctx.moveTo(padL, y(db))
        ctx.lineTo(W - padR, y(db))
        ctx.stroke()
      }
      ctx.setLineDash([])
      ctx.globalAlpha = 1

      // data
      const data = values.slice(-seconds)
      const n = data.length
      if (n < 2) {
        ctx.fillStyle = '#64748b'
        ctx.textAlign = 'center'
        ctx.fillText('Collecting data…', padL + plotW / 2, padT + plotH / 2)
        return
      }
      ctx.lineWidth = 2.5
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      for (let i = 1; i < n; i++) {
        ctx.strokeStyle = ZONE_COLOR[classifyLevel(data[i], caution, alarm)]
        ctx.beginPath()
        ctx.moveTo(x(i - 1, n), y(data[i - 1]))
        ctx.lineTo(x(i, n), y(data[i]))
        ctx.stroke()
      }
    }

    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [values, min, max, caution, alarm, seconds, height])

  return <canvas ref={canvasRef} className="cls-history" style={{ height }} aria-label="Noise level over the last minutes" />
}
