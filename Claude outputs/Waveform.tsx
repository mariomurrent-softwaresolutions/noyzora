import { useEffect, useRef } from 'react'

interface Props {
  analyser: AnalyserNode | null
  height?: number
}

const BAR_WIDTH = 3
const GAP = 1

/**
 * Scrolling waveform: every frame the peak amplitude of the newest audio is
 * pushed onto the right edge and older bars scroll to the left.
 */
export default function Waveform({ analyser, height = 220 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    let cssWidth = 0
    let history: number[] = []

    const resize = () => {
      cssWidth = canvas.clientWidth
      canvas.width = Math.floor(cssWidth * dpr)
      canvas.height = Math.floor(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    const styles = getComputedStyle(document.documentElement)
    const barColor = styles.getPropertyValue('--wave').trim() || '#38bdf8'
    const lineColor = styles.getPropertyValue('--grid').trim() || '#334155'

    const data = new Float32Array(analyser ? analyser.fftSize : 0)
    let raf = 0

    const draw = () => {
      const maxBars = Math.max(1, Math.floor(cssWidth / (BAR_WIDTH + GAP)))

      let peak = 0
      if (analyser) {
        analyser.getFloatTimeDomainData(data)
        for (let i = 0; i < data.length; i++) {
          const a = Math.abs(data[i])
          if (a > peak) peak = a
        }
      }
      history.push(peak)
      if (history.length > maxBars) history = history.slice(history.length - maxBars)

      ctx.clearRect(0, 0, cssWidth, height)

      const mid = height / 2
      ctx.strokeStyle = lineColor
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, mid)
      ctx.lineTo(cssWidth, mid)
      ctx.stroke()

      ctx.fillStyle = barColor
      const offset = cssWidth - history.length * (BAR_WIDTH + GAP)
      for (let i = 0; i < history.length; i++) {
        // sqrt gives quiet sounds a visible height without clipping loud ones
        const h = Math.max(2, Math.sqrt(history[i]) * height)
        ctx.fillRect(offset + i * (BAR_WIDTH + GAP), mid - h / 2, BAR_WIDTH, h)
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [analyser, height])

  return <canvas ref={canvasRef} className="waveform" style={{ height }} />
}
