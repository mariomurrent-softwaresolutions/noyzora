import { useEffect, useRef } from 'react'

export type VizMode = 'ridge' | 'aurora' | 'orbit'

interface Props {
  analyser: AnalyserNode | null
  mode: VizMode
  /** Input level (dBFS) above which the visualizer comes alive. */
  thresholdDb: number
}

const POINTS = 180 // samples per waveform snapshot
const HISTORY = 72 // snapshots kept for the trailing layers
const LAYERS = 9
const LAYER_LAG = 4 // frames between two trailing layers
const PARTICLES = 110
const BLOOM_DIV = 6 // glow buffer is 1/6 of the screen size
const IDLE_AMP = 0.45 // how tall the resting wave is, relative to real sound
const IDLE_SPEED = 0.6 // how fast the resting wave drifts

// spectrum ("ridge") look
const COLS = 128 // frequency columns, log-spaced
const FMIN = 60
const FMAX = 12000
const SPEC_LAYERS = 16 // stacked ridge lines
const SPEC_LAG = 3 // frames between two ridge lines
const BARS = 140 // thin spikes above the peaks

interface Particle {
  x: number
  y: number
  r: number
  v: number
  p: number
}

interface Pulse {
  life: number // 1 -> 0
}

/** Smooth curve through the points using midpoint quadratic segments. */
function curve(ctx: CanvasRenderingContext2D, xs: Float32Array, ys: Float32Array, n: number, closed: boolean) {
  if (closed) {
    ctx.moveTo((xs[n - 1] + xs[0]) / 2, (ys[n - 1] + ys[0]) / 2)
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      ctx.quadraticCurveTo(xs[i], ys[i], (xs[i] + xs[j]) / 2, (ys[i] + ys[j]) / 2)
    }
  } else {
    ctx.moveTo(xs[0], ys[0])
    for (let i = 1; i < n - 1; i++) {
      ctx.quadraticCurveTo(xs[i], ys[i], (xs[i] + xs[i + 1]) / 2, (ys[i] + ys[i + 1]) / 2)
    }
    ctx.lineTo(xs[n - 1], ys[n - 1])
  }
}

/**
 * Full-screen glowing waveform. Two looks:
 *  - aurora: mirrored, gradient-coloured ribbons that flow across the screen with a trail
 *  - orbit:  the waveform wrapped into a pulsing ring with spokes and shockwaves
 * When nothing is heard a soft light wave drifts on its own; real sound takes over
 * and makes everything bigger, brighter and faster.
 */
export default function FancyVisualizer({ analyser, mode, thresholdDb }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const modeRef = useRef<VizMode>(mode)

  const thresholdRef = useRef(thresholdDb)

  useEffect(() => {
    modeRef.current = mode
  }, [mode])

  useEffect(() => {
    thresholdRef.current = thresholdDb
  }, [thresholdDb])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return
    const g: CanvasRenderingContext2D = context

    // low-res copy of the frame, scaled back up on top = cheap bloom / glow
    const bloom = document.createElement('canvas')
    const bctx = bloom.getContext('2d')

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const layers = reduceMotion ? 3 : LAYERS

    let W = 0
    let H = 0
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      W = canvas.clientWidth
      H = canvas.clientHeight
      canvas.width = Math.floor(W * dpr)
      canvas.height = Math.floor(H * dpr)
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      bloom.width = Math.max(1, Math.ceil(W / BLOOM_DIV))
      bloom.height = Math.max(1, Math.ceil(H / BLOOM_DIV))
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    if (analyser) {
      // narrower range = quiet sounds register more clearly in the spectrum
      analyser.minDecibels = -85
      analyser.maxDecibels = -25
    }
    const raw = new Float32Array(analyser ? analyser.fftSize : 1)
    const history = Array.from({ length: HISTORY }, () => new Float32Array(POINTS))
    const xs = new Float32Array(POINTS * 2)
    const ys = new Float32Array(POINTS * 2)
    const envelope = new Float32Array(POINTS)
    for (let i = 0; i < POINTS; i++) envelope[i] = Math.pow(Math.sin((Math.PI * i) / (POINTS - 1)), 1.4)

    const particles: Particle[] = Array.from({ length: PARTICLES }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: Math.random() * 1.8 + 0.4,
      v: Math.random() * 0.04 + 0.01,
      p: Math.random() * Math.PI * 2,
    }))
    const pulses: Pulse[] = []

    // spectrum data
    const specHist = Array.from({ length: HISTORY }, () => new Float32Array(COLS))
    const specSmooth = new Float32Array(COLS)
    const realSpec = new Float32Array(COLS)
    const bins = new Uint8Array(analyser ? analyser.frequencyBinCount : 1)
    const colLo = new Int32Array(COLS)
    const colHi = new Int32Array(COLS)
    {
      const sr = analyser ? analyser.context.sampleRate : 48000
      const fft = analyser ? analyser.fftSize : 2048
      for (let c = 0; c < COLS; c++) {
        const f0 = FMIN * Math.pow(FMAX / FMIN, c / COLS)
        const f1 = FMIN * Math.pow(FMAX / FMIN, (c + 1) / COLS)
        const lo = Math.min(bins.length - 1, Math.floor((f0 * fft) / sr))
        colLo[c] = lo
        colHi[c] = Math.min(bins.length, Math.max(lo + 1, Math.ceil((f1 * fft) / sr)))
      }
    }
    const barRand = Float32Array.from({ length: BARS }, () => 0.05 + Math.pow(Math.random(), 2) * 0.9)
    const barVal = new Float32Array(BARS)

    /** Soft drifting mountain range shown while nothing is heard. */
    const idleSpec = (c: number, t: number) => {
      const x = c / COLS
      let v = 0.03 + 0.02 * Math.sin(x * 23 + t * 0.9)
      for (let k = 0; k < 7; k++) {
        const m = (k + 0.5) / 7 + 0.07 * Math.sin(t * (0.21 + 0.05 * k) + k * 1.9)
        const amp = 0.1 + 0.32 * (0.5 + 0.5 * Math.sin(t * (0.33 + 0.07 * k) + k * 2.7))
        const sigma = 0.03 + 0.012 * ((k * 3) % 4)
        const d = (x - m) / sigma
        v += amp * Math.exp(-d * d)
      }
      return v + 0.02 * Math.sin(c * 1.3 + t * 1.1)
    }

    // fade the ridge to the baseline at both ends
    const taper = new Float32Array(COLS)
    for (let c = 0; c < COLS; c++) {
      const u = Math.min(1, Math.min(c, COLS - 1 - c) / 10)
      taper[c] = u * u * (3 - 2 * u)
    }

    let head = 0
    let energy = 0 // smoothed loudness of real sound only (0 when silent)
    let prevEnergy = 0
    let lastPulse = 0
    // 0 = silence, 1 = sound heard
    let gate = 0
    let flash = 0 // brief brightness kick on sudden loud sounds
    let prevFlashE = 0

    /** Snapshot of the waveform into history[head]: real sound, or a soft drifting wave when silent. */
    const capture = (t: number) => {
      const ti = t * IDLE_SPEED // slow clock for the resting wave
      const out = history[head]
      let level = 0
      if (analyser) {
        analyser.getFloatTimeDomainData(raw)
        let sq = 0
        for (let i = 0; i < raw.length; i++) sq += raw[i] * raw[i]
        level = Math.sqrt(sq / raw.length)
        const span = raw.length >> 1
        // start at a rising zero crossing so the shape stays stable between frames
        let start = 0
        for (let i = 1; i < span; i++) {
          if (raw[i - 1] < 0 && raw[i] >= 0) {
            start = i
            break
          }
        }
        for (let i = 0; i < POINTS; i++) {
          const a = start + Math.floor((i * span) / POINTS)
          const b = start + Math.floor(((i + 1) * span) / POINTS)
          let sum = 0
          for (let j = a; j < b; j++) sum += raw[j]
          out[i] = Math.tanh((sum / Math.max(1, b - a)) * 6) // soft-clip so loud sounds stay on screen
        }
      } else {
        out.fill(0)
      }

      // graded noise gate: shut 6 dB below the threshold, fully open 6 dB above it
      const levelDb = level > 0 ? 20 * Math.log10(level) : -120
      const x = Math.min(1, Math.max(0, (levelDb - (thresholdRef.current - 6)) / 12))
      const target = x * x * (3 - 2 * x)
      gate += (target - gate) * (target > gate ? 0.5 : 0.06)

      let sq = 0
      for (let i = 0; i < POINTS; i++) {
        const real = out[i] * gate
        sq += real * real
        const idle =
          0.13 * Math.sin(i * 0.06 + ti * 0.9) * Math.sin(ti * 0.45 + i * 0.012) + 0.05 * Math.sin(i * 0.17 - ti * 1.6)
        out[i] = real + idle * IDLE_AMP * (1 - gate)
      }
      energy += (Math.sqrt(sq / POINTS) - energy) * 0.15

      // frequency spectrum for the ridge look
      const spec = specHist[head]
      if (analyser) {
        analyser.getByteFrequencyData(bins)
        for (let c = 0; c < COLS; c++) {
          let m = 0
          for (let j = colLo[c]; j < colHi[c]; j++) if (bins[j] > m) m = bins[j]
          // emphasise peaks, hide the noise floor, tilt up the quiet high end
          realSpec[c] = Math.min(1, Math.pow(m / 255, 1.5) * (1 + (0.9 * c) / COLS))
        }
      } else {
        realSpec.fill(0)
      }
      for (let c = 0; c < COLS; c++) {
        const target = realSpec[c] * gate
        const cur = specSmooth[c]
        specSmooth[c] = cur + (target - cur) * (target > cur ? 0.7 : 0.16)
        spec[c] = specSmooth[c] + idleSpec(c, ti) * IDLE_AMP * (1 - gate)
      }
      let prev = spec[0]
      for (let c = 1; c < COLS - 1; c++) {
        const cur = spec[c]
        spec[c] = (prev + 6 * cur + spec[c + 1]) / 8
        prev = cur
      }
      for (let c = 0; c < COLS; c++) spec[c] *= taper[c]
    }

    /** Overall brightness: calm glow while silent, full blaze when sound is heard. */
    const vis = () => Math.min(1.25, 0.6 + 0.4 * gate + 0.35 * flash)

    const drawAurora = (t: number, e: number) => {
      const cy = H / 2
      const amp = H * 0.3

      // glowing horizon
      const horizon = g.createLinearGradient(0, 0, W, 0)
      const hh = 200 + 90 * Math.sin(t * 0.2) + e * 40
      horizon.addColorStop(0, `hsla(${hh - 70}, 100%, 60%, 0)`)
      horizon.addColorStop(0.5, `hsla(${hh}, 100%, 70%, ${0.35 * vis()})`)
      horizon.addColorStop(1, `hsla(${hh + 70}, 100%, 60%, 0)`)
      g.fillStyle = horizon
      g.fillRect(0, cy - 0.75, W, 1.5)

      for (let l = layers - 1; l >= 0; l--) {
        const fr = history[(head - l * LAYER_LAG + HISTORY * 2) % HISTORY]
        const hue = 200 + 90 * Math.sin(t * 0.2) + l * 12 + e * 40
        const alpha = (1 - (l / layers) * 0.9) * vis()
        const scale = 1 - l * 0.04
        for (let i = 0; i < POINTS; i++) {
          xs[i] = (i / (POINTS - 1)) * W
          ys[i] = cy - fr[i] * amp * envelope[i] * scale
        }

        // colour changes along the ribbon
        const stroke = g.createLinearGradient(0, 0, W, 0)
        stroke.addColorStop(0, `hsla(${hue - 70}, 100%, 66%, ${alpha})`)
        stroke.addColorStop(0.5, `hsla(${hue}, 100%, ${l === 0 ? 84 : 68}%, ${alpha})`)
        stroke.addColorStop(1, `hsla(${hue + 70}, 100%, 66%, ${alpha})`)
        // soft haze between the ribbon and the horizon
        const haze = g.createLinearGradient(0, cy - amp, 0, cy)
        haze.addColorStop(0, `hsla(${hue}, 95%, 60%, 0)`)
        haze.addColorStop(1, `hsla(${hue}, 95%, 60%, ${0.16 * alpha})`)

        for (let pass = 0; pass < 2; pass++) {
          g.save()
          if (pass === 1) {
            g.translate(0, 2 * cy)
            g.scale(1, -1)
          }
          g.beginPath()
          curve(g, xs, ys, POINTS, false)
          g.shadowBlur = l === 0 ? 26 : 14
          g.shadowColor = `hsla(${hue}, 100%, 60%, ${alpha})`
          g.strokeStyle = stroke
          g.lineWidth = l === 0 ? 2.8 : 1.6
          g.stroke()
          if (l < 4) {
            g.lineTo(W, cy)
            g.lineTo(0, cy)
            g.closePath()
            g.shadowBlur = 0
            g.fillStyle = haze
            g.fill()
          }
          g.restore()
        }
      }
    }

    const drawOrbit = (t: number, e: number, now: number) => {
      const cx = W / 2
      const cy = H / 2
      const R = Math.min(W, H) * 0.2
      const amp = R * 0.85
      const baseHue = 200 + 90 * Math.sin(t * 0.2) + e * 40

      // core glow
      const coreR = R * (1.1 + e * 0.5)
      const core = g.createRadialGradient(cx, cy, 0, cx, cy, coreR)
      core.addColorStop(0, `hsla(${baseHue}, 100%, 70%, ${0.25 + 0.45 * e})`)
      core.addColorStop(1, `hsla(${baseHue}, 100%, 50%, 0)`)
      g.fillStyle = core
      g.beginPath()
      g.arc(cx, cy, coreR, 0, Math.PI * 2)
      g.fill()

      // shockwave on sudden loudness jumps
      if (gate > 0.5 && e - prevEnergy > 0.06 && now - lastPulse > 220) {
        pulses.push({ life: 1 })
        lastPulse = now
      }
      prevEnergy = e
      for (let k = pulses.length - 1; k >= 0; k--) {
        const p = pulses[k]
        p.life -= 0.014
        if (p.life <= 0) {
          pulses.splice(k, 1)
          continue
        }
        const pr = R * 1.1 + (1 - p.life) * Math.min(W, H) * 0.5
        g.shadowBlur = 0
        g.strokeStyle = `hsla(${baseHue + 40}, 100%, 70%, ${p.life * 0.5})`
        g.lineWidth = 1 + p.life * 2
        g.beginPath()
        g.arc(cx, cy, pr, 0, Math.PI * 2)
        g.stroke()
      }

      const N = POINTS * 2
      const rotBase = t * 0.12 * (0.3 + 0.7 * gate)

      // spokes that follow the waveform
      const fr0 = history[head]
      const spokeStart = R + layers * 7 + 12
      g.shadowBlur = 0
      g.strokeStyle = `hsla(${baseHue + 30}, 100%, 75%, ${0.5 * vis()})`
      g.lineWidth = 1.2
      g.beginPath()
      for (let j = 0; j < N; j += 3) {
        const idx = j < POINTS ? j : N - 1 - j
        const ang = (j / N) * Math.PI * 2 + rotBase - Math.PI / 2
        const len = 3 + Math.abs(fr0[idx]) * amp * 0.9
        g.moveTo(cx + Math.cos(ang) * spokeStart, cy + Math.sin(ang) * spokeStart)
        g.lineTo(cx + Math.cos(ang) * (spokeStart + len), cy + Math.sin(ang) * (spokeStart + len))
      }
      g.stroke()

      for (let l = layers - 1; l >= 0; l--) {
        const fr = history[(head - l * LAYER_LAG + HISTORY * 2) % HISTORY]
        const hue = baseHue + l * 14
        const alpha = (1 - (l / layers) * 0.9) * vis()
        const rot = rotBase + l * 0.05
        for (let j = 0; j < N; j++) {
          const idx = j < POINTS ? j : N - 1 - j // mirrored so the ring closes seamlessly
          const ang = (j / N) * Math.PI * 2 + rot - Math.PI / 2
          const r = R + l * 7 + fr[idx] * amp * (1 - l * 0.05)
          xs[j] = cx + Math.cos(ang) * r
          ys[j] = cy + Math.sin(ang) * r
        }
        g.beginPath()
        curve(g, xs, ys, N, true)
        g.closePath()
        g.shadowBlur = l === 0 ? 26 : 14
        g.shadowColor = `hsla(${hue}, 100%, 60%, ${alpha})`
        g.strokeStyle = `hsla(${hue}, 100%, ${l === 0 ? 82 : 66}%, ${alpha})`
        g.lineWidth = l === 0 ? 2.8 : 1.6
        g.stroke()
        if (l === 0) {
          g.shadowBlur = 0
          g.fillStyle = `hsla(${hue}, 95%, 60%, 0.06)`
          g.fill()
        }
      }
    }

    const drawRidge = (t: number) => {
      const y0 = H * 0.74
      const ampH = H * 0.5
      const x0 = W * 0.04
      const span = W * 0.92
      const hs = 12 * Math.sin(t * 0.2)
      const lift = SPEC_LAYERS * 2.4
      const front = specHist[head]

      // teal -> pink -> blue -> pink -> teal along the width
      const gradient = (alpha: number) => {
        const gr = g.createLinearGradient(x0, 0, x0 + span, 0)
        gr.addColorStop(0, `hsla(${165 + hs}, 100%, 58%, ${alpha})`)
        gr.addColorStop(0.32, `hsla(${320 + hs}, 85%, 70%, ${alpha})`)
        gr.addColorStop(0.58, `hsla(${235 + hs}, 90%, 68%, ${alpha})`)
        gr.addColorStop(0.8, `hsla(${300 + hs}, 80%, 70%, ${alpha})`)
        gr.addColorStop(1, `hsla(${160 + hs}, 100%, 58%, ${alpha})`)
        return gr
      }

      // 1. fine vertical mesh under the front ridge
      const STEPS = (COLS - 1) * 3
      g.beginPath()
      for (let k = 0; k <= STEPS; k++) {
        const pos = k / 3
        const c = Math.min(COLS - 2, Math.floor(pos))
        const x = x0 + (pos / (COLS - 1)) * span
        const v = front[c] + (front[c + 1] - front[c]) * (pos - c)
        g.moveTo(x, y0 - v * ampH)
        g.lineTo(x, y0 + lift * 0.6)
      }
      g.strokeStyle = gradient(0.13 * vis())
      g.lineWidth = 1
      g.stroke()
      // let the mesh dissolve towards the floor instead of ending in a hard edge
      const fadeTop = y0 - ampH * 0.1
      const fadeBottom = y0 + lift * 0.6
      const fade = g.createLinearGradient(0, fadeTop, 0, fadeBottom)
      fade.addColorStop(0, 'rgba(1, 1, 7, 0)')
      fade.addColorStop(1, 'rgba(1, 1, 7, 0.95)')
      g.fillStyle = fade
      g.fillRect(0, fadeTop, W, fadeBottom - fadeTop)

      // 2. stacked ridge lines, oldest/back first
      for (let l = SPEC_LAYERS - 1; l >= 0; l--) {
        const fr = specHist[(head - l * SPEC_LAG + HISTORY * 2) % HISTORY]
        const sc = 1 - l * 0.045
        const base = y0 + l * 2.4
        for (let c = 0; c < COLS; c++) {
          xs[c] = x0 + (c / (COLS - 1)) * span
          // older lines wobble a little differently so they cross like a wireframe
          ys[c] = base - fr[c] * ampH * sc * (l === 0 ? 1 : 1 + 0.1 * Math.sin(c * 0.31 + l * 2.1 + t * 0.5))
        }
        const alpha = (1 - (l / SPEC_LAYERS) * 0.82) * vis()
        if (l < 5) {
          g.beginPath()
          curve(g, xs, ys, COLS, false)
          g.lineTo(x0 + span, base)
          g.lineTo(x0, base)
          g.closePath()
          g.fillStyle = gradient(0.05 * alpha)
          g.fill()
        }
        g.beginPath()
        curve(g, xs, ys, COLS, false)
        g.strokeStyle = gradient(alpha)
        g.lineWidth = l === 0 ? 1.8 : 1
        g.shadowBlur = l === 0 ? 12 : 0
        g.shadowColor = `hsla(${300 + hs}, 100%, 65%, 0.6)`
        g.stroke()
        g.shadowBlur = 0
      }

      // 3. thin spikes that rise above the peaks and fall back slowly
      g.beginPath()
      for (let b = 0; b < BARS; b++) {
        const pos = ((b + 0.5) / BARS) * (COLS - 1)
        const c = Math.min(COLS - 2, Math.floor(pos))
        const v = front[c] + (front[c + 1] - front[c]) * (pos - c)
        barVal[b] = Math.max(v * barRand[b] * 1.2, barVal[b] * 0.93)
        const x = x0 + ((b + 0.5) / BARS) * span
        const baseY = y0 - v * ampH
        const len = barVal[b] * ampH * 0.4
        if (len > 1) {
          g.moveTo(x, baseY)
          g.lineTo(x, baseY - len)
        }
      }
      g.strokeStyle = `rgba(215, 235, 255, ${0.3 * vis()})`
      g.lineWidth = 1
      g.stroke()

      // 4. flat wavy lines on the floor
      for (let k = 0; k < 5; k++) {
        const yb = y0 + lift + 10 + k * 9
        for (let c = 0; c < COLS; c++) {
          xs[c] = x0 + (c / (COLS - 1)) * span
          ys[c] = yb - (front[c] * 0.1 + 0.012 * Math.sin(c * 0.35 + t * 0.8 + k)) * ampH * (1 - k * 0.12)
        }
        g.beginPath()
        curve(g, xs, ys, COLS, false)
        g.strokeStyle = gradient(0.32 * (1 - k * 0.15) * vis())
        g.lineWidth = 1
        g.stroke()
      }
    }

    let raf = 0
    const frame = (now: number) => {
      const t = now / 1000
      head = (head + 1) % HISTORY
      capture(t)
      const e = Math.min(1, energy * 2.2)
      const m = modeRef.current
      // onset detector: a sudden rise in loudness flashes the whole picture
      flash = Math.max(flash * 0.9, Math.min(1, Math.max(0, energy - prevFlashE) * 25))
      prevFlashE = energy

      g.globalCompositeOperation = 'source-over'
      g.shadowBlur = 0
      const bgHue = 225 + 40 * Math.sin(t * 0.15)

      if (m === 'ridge') {
        // near-black with one faint violet glow behind the ridge
        g.fillStyle = '#010107'
        g.fillRect(0, 0, W, H)
        g.globalCompositeOperation = 'lighter'
        const gy = H * 0.62
        const glow = g.createRadialGradient(W / 2, gy, 0, W / 2, gy, W * 0.55)
        glow.addColorStop(0, `hsla(285, 80%, 50%, ${0.07 + 0.09 * e})`)
        glow.addColorStop(1, 'hsla(285, 80%, 50%, 0)')
        g.fillStyle = glow
        g.fillRect(0, 0, W, H)
      } else {
        // deep gradient plus two slowly drifting colour clouds
        const bg = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.hypot(W, H) / 2)
        bg.addColorStop(0, `hsl(${bgHue}, 55%, ${8 + e * 10}%)`)
        bg.addColorStop(1, '#03040a')
        g.fillStyle = bg
        g.fillRect(0, 0, W, H)

        g.globalCompositeOperation = 'lighter'
        const cloudR = Math.max(W, H) * 0.45
        for (let k = 0; k < 2; k++) {
          const bx = W * (0.5 + 0.35 * Math.sin(t * 0.13 + k * 2.1))
          const by = H * (0.5 + 0.3 * Math.cos(t * 0.11 + k * 1.7))
          const cloud = g.createRadialGradient(bx, by, 0, bx, by, cloudR)
          cloud.addColorStop(0, `hsla(${bgHue + k * 70}, 80%, 50%, ${0.06 + 0.08 * e})`)
          cloud.addColorStop(1, `hsla(${bgHue + k * 70}, 80%, 50%, 0)`)
          g.fillStyle = cloud
          g.fillRect(0, 0, W, H)
        }

        // drifting dust: lazy when silent, fast and bright with sound
        for (const p of particles) {
          p.y -= p.v * 0.004 * (0.3 + gate * (1 + e * 6))
          if (p.y < 0) {
            p.y = 1
            p.x = Math.random()
          }
          const tw = Math.sin(t * 1.5 + p.p)
          g.fillStyle = `rgba(190, 220, 255, ${(0.12 + 0.25 * tw * tw) * (0.5 + 0.5 * gate)})`
          g.beginPath()
          g.arc(p.x * W, p.y * H, p.r, 0, Math.PI * 2)
          g.fill()
        }
      }

      if (m === 'ridge') drawRidge(t)
      else if (m === 'aurora') drawAurora(t, e)
      else drawOrbit(t, e, now)

      // bloom: blurry low-res copy of the frame added back on top
      if (bctx) {
        bctx.globalCompositeOperation = 'copy'
        bctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, bloom.width, bloom.height)
        g.shadowBlur = 0
        g.globalCompositeOperation = 'lighter'
        g.globalAlpha = (m === 'ridge' ? 0.3 : 0.45) + 0.2 * gate + 0.25 * flash
        g.drawImage(bloom, 0, 0, W, H)
        g.globalAlpha = 1
      }

      // vignette
      g.globalCompositeOperation = 'source-over'
      const vig = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.6)
      vig.addColorStop(0, 'rgba(0, 0, 0, 0)')
      vig.addColorStop(1, 'rgba(0, 0, 0, 0.6)')
      g.fillStyle = vig
      g.fillRect(0, 0, W, H)

      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [analyser])

  return <canvas ref={canvasRef} className="viz-canvas" aria-hidden="true" />
}
