import type { ArkhamFinding } from './connectors/arkham.connector'
import type { ZerionExposure } from './connectors/zerion.connector'
import type { NeynarIdentity } from './connectors/neynar.connector'

export type PrivacyBand = 'Low' | 'Moderate' | 'High' | 'Critical'

export type PrivacyScoreResult = {
  /** 0–100: mayor = mejor privacidad (menos exposición inferida) */
  score: number
  band: PrivacyBand
  /** 0–1 según fuentes disponibles y calidad de señal */
  confidence: number
}

/** Pesos fijos — determinísticos para la misma entrada. */
const WEIGHT_USD = 0.42
const WEIGHT_ARKHAM = 0.33
const WEIGHT_SOCIAL = 0.2
const WEIGHT_INCOMPLETE = 0.05

const clamp = (n: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, n))

const bandFromScore = (score: number): PrivacyBand => {
  if (score >= 76) {
    return 'Low'
  }
  if (score >= 51) {
    return 'Moderate'
  }
  if (score >= 26) {
    return 'High'
  }
  return 'Critical'
}

/**
 * Convierte USD visible a penalización 0–1 (suave, capped).
 * log1p evita dominar con valores enormes.
 */
const usdPenalty = (totalUsd: number): number => {
  if (totalUsd <= 0) {
    return 0
  }
  const x = Math.log1p(totalUsd) / Math.log1p(1_000_000)
  return clamp(x, 0, 1)
}

/** Señal de inteligencia on-chain / etiquetas (0–1). */
const arkhamPenalty = (arkham?: ArkhamFinding): number => {
  if (!arkham) {
    return 0.35
  }
  const labels = arkham.labels?.length ?? 0
  const entities = arkham.entities?.length ?? 0
  const raw = labels * 0.06 + entities * 0.04
  return clamp(raw + (labels + entities === 0 ? 0.08 : 0), 0, 1)
}

const socialPenalty = (neynar?: NeynarIdentity): number => {
  if (!neynar) {
    return 0.2
  }
  return neynar.found ? 1 : 0.05
}

/**
 * Issue 1.6 — motor de score determinístico.
 */
export const computePrivacyScore = (input: {
  arkham?: ArkhamFinding
  zerion?: ZerionExposure
  neynar?: NeynarIdentity
}): PrivacyScoreResult => {
  const usd = input.zerion?.totalUsdVisible ?? 0
  const pUsd = usdPenalty(usd)
  const pArk = arkhamPenalty(input.arkham)
  const pSoc = socialPenalty(input.neynar)

  let sources = 0
  if (input.arkham) {
    sources++
  }
  if (input.zerion) {
    sources++
  }
  if (input.neynar) {
    sources++
  }
  const pMiss = (3 - sources) / 3

  const penalty =
    WEIGHT_USD * pUsd +
    WEIGHT_ARKHAM * pArk +
    WEIGHT_SOCIAL * pSoc +
    WEIGHT_INCOMPLETE * pMiss

  const score = Math.round(clamp(100 * (1 - penalty), 0, 100))
  const confidence = Math.round((sources / 3) * 100) / 100

  return {
    score,
    band: bandFromScore(score),
    confidence,
  }
}
