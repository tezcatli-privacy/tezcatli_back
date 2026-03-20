import type { ArkhamFinding } from './connectors/arkham.connector'
import type { ZerionExposure } from './connectors/zerion.connector'
import type { NeynarIdentity } from './connectors/neynar.connector'
import type { PrivacyScoreResult, PrivacyBand } from './privacy_score_engine'

export type Report = {
  summary: {
    privacy: PrivacyScoreResult
    signals: {
      arkhamOk: boolean
      zerionOk: boolean
      neynarOk: boolean
      zerionTotalUsdVisible?: number
    }
  }
  pillars: {
    identity: {
      title: string
      description: string
    }
    financial: {
      title: string
      description: string
    }
    social: {
      title: string
      description: string
    }
  }
  findings: Array<{
    id: string
    pillar: 'identity' | 'financial' | 'social' | 'privacy'
    severity: 'low' | 'moderate' | 'high' | 'critical'
    title: string
    details: string
  }>
  recommendations: Array<{
    id: string
    priority: 'low' | 'medium' | 'high'
    title: string
    description: string
  }>
  conversion: {
    // Issue 1.7: sección incluida para que el frontend pueda montar la capa de tracking
    // (la instrumentación real se gestiona en issues posteriores).
    funnelEvents: {
      reportToCtaClick: 'report_to_cta_click'
      ctaClickToStage2Start: 'cta_to_stage2_start'
    }
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null

const asString = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v : undefined

const severityFromBand = (band: PrivacyBand): Report['findings'][number]['severity'] => {
  if (band === 'Low') return 'low'
  if (band === 'Moderate') return 'moderate'
  if (band === 'High') return 'high'
  return 'critical'
}

const severityFromCounts = (labelsCount: number, entitiesCount: number): Report['findings'][number]['severity'] => {
  const n = labelsCount + entitiesCount
  if (n >= 20) return 'critical'
  if (n >= 10) return 'high'
  if (n >= 1) return 'moderate'
  return 'low'
}

const severityFromUsd = (totalUsdVisible: number): Report['findings'][number]['severity'] => {
  if (totalUsdVisible >= 10_000_000) return 'critical'
  if (totalUsdVisible >= 1_000_000) return 'high'
  if (totalUsdVisible >= 1_000) return 'moderate'
  if (totalUsdVisible > 0) return 'low'
  return 'low'
}

const topChains = (
  perChainUsd: Record<string, number> | undefined,
  limit: number
): Array<{ chain: string; usd: number }> => {
  if (!perChainUsd) return []
  return Object.entries(perChainUsd)
    .filter(([, v]) => Number.isFinite(v) && v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([chain, usd]) => ({ chain, usd }))
}

export const composeReport = (input: {
  privacy: PrivacyScoreResult
  arkham?: ArkhamFinding
  zerion?: ZerionExposure
  neynar?: NeynarIdentity
}): Report => {
  const { privacy, arkham, zerion, neynar } = input

  const arkhamOk = Boolean(arkham)
  const zerionOk = Boolean(zerion)
  const neynarOk = Boolean(neynar)

  const labelsCount = arkham?.labels?.length ?? 0
  const entitiesCount = arkham?.entities?.length ?? 0
  const totalUsdVisible = zerion?.totalUsdVisible
  const socialLinked = Boolean(neynar?.found)

  const identitySeverity = severityFromCounts(labelsCount, entitiesCount)
  const financialSeverity = severityFromUsd(totalUsdVisible ?? 0)
  const socialSeverity = socialLinked ? 'high' : 'low'
  const privacySeverity = severityFromBand(privacy.band)

  const chains = topChains(zerion?.perChainUsd, 3)

  // Nota: evitamos persistir `raw` y evitamos incluir directamente direcciones.
  const topLabelNames = (arkham?.labels ?? [])
    .map((l) => {
      if (!isRecord(l)) return undefined
      const name = asString(l.name)
      const chainType = asString(l.chainType)
      if (!name) return undefined
      return chainType ? `${name} (${chainType})` : name
    })
    .filter((x): x is string => Boolean(x))
    .slice(0, 5)

  const findings: Report['findings'] = [
    {
      id: 'privacy-score',
      pillar: 'privacy',
      severity: privacySeverity,
      title: 'Nivel de privacidad estimado',
      details: `Score ${privacy.score} (${privacy.band}) con confianza ${privacy.confidence}.`,
    },
  ]

  findings.push({
    id: 'identity-signals',
    pillar: 'identity',
    severity: identitySeverity,
    title: 'Señales de identidad on-chain (Arkham)',
    details:
      labelsCount + entitiesCount > 0
        ? `Arkham asocia ${entitiesCount} entidades y ${labelsCount} etiquetas. ` +
          (topLabelNames.length > 0 ? `Ejemplos: ${topLabelNames.join(', ')}.` : '')
        : 'No se encontraron etiquetas/entidades de Arkham para esta wallet.',
  })

  findings.push({
    id: 'financial-exposure',
    pillar: 'financial',
    severity: financialSeverity,
    title: 'Exposición financiera visible (Zerion)',
    details:
      typeof totalUsdVisible === 'number'
        ? `Total visible: ${totalUsdVisible.toFixed(2)} USD. ` +
          (chains.length > 0
            ? `Top cadenas: ${chains
                .map((c) => `${c.chain} (${c.usd.toFixed(2)} USD)`)
                .join(', ')}.`
            : '')
        : 'No se obtuvo exposición financiera desde Zerion.',
  })

  findings.push({
    id: 'social-link',
    pillar: 'social',
    severity: socialSeverity,
    title: 'Vinculación social (Neynar)',
    details: socialLinked
      ? `Se detectó una identidad Farcaster asociada (p. ej. ${neynar?.username ?? 'username'}).`
      : 'No se detectó identidad Farcaster asociada.',
  })

  const recommendations: Report['recommendations'] = []
  const highRisk = privacy.band === 'High' || privacy.band === 'Critical'

  recommendations.push({
    id: 'rec-privacy-1',
    priority: highRisk ? 'high' : 'medium',
    title: 'Reduce correlación entre wallet e identidad',
    description:
      'Evita vincular (directa o indirectamente) perfiles sociales a la misma wallet si tu objetivo es reducir correlación.',
  })

  recommendations.push({
    id: 'rec-financial-1',
    priority: financialSeverity === 'critical' || financialSeverity === 'high' ? 'high' : 'medium',
    title: 'Minimiza exposición financiera observable',
    description:
      'La exposición financiera visible tiende a aumentar el “contexto” público de la wallet. Para reducir inferencias, limita depósitos/actividad en cuentas que busques mantener más privadas.',
  })

  recommendations.push({
    id: 'rec-onchain-1',
    priority: identitySeverity === 'critical' || identitySeverity === 'high' ? 'high' : 'medium',
    title: 'Revisa etiquetas/atribuciones on-chain',
    description:
      'Las etiquetas y atribuciones (Arkham) incrementan señales de identidad. Usa una wallet dedicada por propósito cuando sea posible.',
  })

  recommendations.push({
    id: 'rec-general-1',
    priority: 'medium',
    title: 'Valida el reporte con la fuente original',
    description:
      'Siempre revisa el JSON completo y la fuente del conector para confirmar qué señales se consideraron antes de tomar decisiones.',
  })

  return {
    summary: {
      privacy,
      signals: {
        arkhamOk,
        zerionOk,
        neynarOk,
        zerionTotalUsdVisible: zerion?.totalUsdVisible,
      },
    },
    pillars: {
      identity: {
        title: 'Identidad',
        description: 'Señales de atribución y etiquetas (Arkham).',
      },
      financial: {
        title: 'Finanzas',
        description: 'Exposición financiera visible agregada (Zerion).',
      },
      social: {
        title: 'Social',
        description: 'Vinculación de identidad social (Neynar/Farcaster).',
      },
    },
    findings,
    recommendations,
    conversion: {
      funnelEvents: {
        reportToCtaClick: 'report_to_cta_click',
        ctaClickToStage2Start: 'cta_to_stage2_start',
      },
    },
  }
}

