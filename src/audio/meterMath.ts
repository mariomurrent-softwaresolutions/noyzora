/** Pure helpers for level metering. No Web Audio in here, so they are easy to unit-test. */

/** Floor of the scale: anything quieter is reported as this. */
export const MIN_DB = -90

export function powerToDb(power: number): number {
  if (power <= 0) return MIN_DB
  return Math.max(MIN_DB, 10 * Math.log10(power))
}

export function dbToPower(db: number): number {
  return Math.pow(10, db / 10)
}

/** Mean square of a buffer of samples, i.e. the signal power. */
export function meanSquare(samples: Float32Array): number {
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
  return samples.length > 0 ? sum / samples.length : 0
}

/**
 * Weight of the newest value in an exponential moving average with time constant `tauMs`.
 * Depends on elapsed time, not on the number of frames, so the result looks the same on a
 * 60 Hz and a 144 Hz screen.
 */
export function smoothingCoefficient(dtMs: number, tauMs: number): number {
  if (dtMs <= 0) return 0
  return 1 - Math.exp(-dtMs / tauMs)
}

export type LevelZone = 'calm' | 'caution' | 'alarm'

export function classifyLevel(db: number, cautionDb: number, alarmDb: number): LevelZone {
  if (db >= alarmDb) return 'alarm'
  if (db >= cautionDb) return 'caution'
  return 'calm'
}

/** Energy average (Leq) of several levels given in dB. */
export function equivalentLevel(levelsDb: readonly number[]): number {
  if (levelsDb.length === 0) return MIN_DB
  let sum = 0
  for (const level of levelsDb) sum += dbToPower(level)
  return powerToDb(sum / levelsDb.length)
}
