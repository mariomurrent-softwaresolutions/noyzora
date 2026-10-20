/**
 * A-weighting filter for the Web Audio API.
 *
 * Sound level meters weight the signal to follow human hearing (quiet below ~500 Hz and above
 * ~10 kHz, most sensitive around 2-4 kHz). The analog A-weighting curve has four corner
 * frequencies; it is built here from three biquads plus a gain trim that sets 0 dB at 1 kHz.
 *
 *   H(s) = k * s^4 / ((s+w1)^2 (s+w2) (s+w3) (s+w4)^2)
 *
 *   highpass @ f1, Q 0.5           -> s^2 / (s+w1)^2        (double pole)
 *   highpass @ sqrt(f2*f3)         -> s^2 / ((s+w2)(s+w3))  (two distinct real poles)
 *   lowpass  @ f4, Q 0.5           -> w4^2 / (s+w4)^2       (double pole)
 *
 * Note: in Web Audio the Q of lowpass/highpass filters is given in dB.
 */

const F1 = 20.598997
const F2 = 107.65265
const F3 = 737.86223
const F4 = 12194.217

const qToDb = (q: number) => 20 * Math.log10(q)

export interface AWeightingChain {
  input: AudioNode
  output: AudioNode
}

function magnitudeAt(filters: BiquadFilterNode[], hz: number): number {
  const freq = new Float32Array([hz])
  const mag = new Float32Array(1)
  const phase = new Float32Array(1)
  let total = 1
  for (const node of filters) {
    node.getFrequencyResponse(freq, mag, phase)
    total *= mag[0]
  }
  return total
}

export function createAWeighting(ctx: BaseAudioContext): AWeightingChain {
  const f23 = Math.sqrt(F2 * F3)
  const hp1 = new BiquadFilterNode(ctx, { type: 'highpass', frequency: F1, Q: qToDb(0.5) })
  const hp2 = new BiquadFilterNode(ctx, { type: 'highpass', frequency: f23, Q: qToDb(f23 / (F2 + F3)) })
  const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: F4, Q: qToDb(0.5) })
  const trim = new GainNode(ctx)

  hp1.connect(hp2)
  hp2.connect(lp)
  lp.connect(trim)
  trim.gain.value = 1 / magnitudeAt([hp1, hp2, lp], 1000) // 0 dB at 1 kHz by definition

  return { input: hp1, output: trim }
}
