import type { Redis } from 'ioredis'
import {
  fetchArkhamAddressIntelligence,
  type ArkhamFinding,
} from './connectors/arkham.connector'
import {
  fetchZerionExposure,
  type ZerionExposure,
} from './connectors/zerion.connector'
import {
  fetchNeynarIdentity,
  type NeynarIdentity,
} from './connectors/neynar.connector'
import {
  type WavyRiskScan,
} from './connectors/wavy.connector'
import {
  saveScanSession,
  type ScanSessionRedisPayload,
} from './scan_session_store'
import { computePrivacyScore, type PrivacyScoreResult } from './privacy_score_engine'
import { promiseWithTimeout } from '../utils/promise_timeout'
import { composeReport, type Report } from './report_composer'
import { withNoiseQueries } from './noise_query_engine'
import {
  alphaSupportedAssets,
  nextActionsBeforeEligibility,
  type AlphaNextAction,
  type AlphaSupportedAsset,
} from './alpha_policy'

type ScanStage = 'identity' | 'financial' | 'exchange' | 'score'
type StageStatus = 'completed' | 'partial' | 'failed' | 'skipped'

export type ScanStageResult = {
  stage: ScanStage
  status: StageStatus
  progress: number
  error?: string
}

export type ScanSessionContext = {
  scanSessionId: string
  walletRef: string
  createdAt: string
}

export type ScanResult = {
  scanSessionId: string
  status: 'completed' | 'partial'
  progress: number
  currentStage?: string
  stages: ScanStageResult[]
  privacy: PrivacyScoreResult
  report: Report
  supportedAssets: AlphaSupportedAsset[]
  nextActions: AlphaNextAction[]
  data: {
    arkham?: ArkhamFinding
    zerion?: ZerionExposure
    neynar?: NeynarIdentity
  }
}

export type ScanOrchestratorDeps = {
  redis?: Redis
  sessionTtlSeconds: number
  providerTimeoutMs: number
}

const getErrorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : 'Unknown error'

const nowIso = (): string => new Date().toISOString()
const currentStageFromStages = (stages: ScanStageResult[]): string | undefined => {
  if (stages.length === 0) return undefined
  return stages[stages.length - 1]?.stage
}

export const runScanOrchestrator = async (
  address: string,
  session: ScanSessionContext,
  deps: ScanOrchestratorDeps
): Promise<ScanResult> => {
  const { scanSessionId, walletRef, createdAt } = session
  const { redis, sessionTtlSeconds, providerTimeoutMs } = deps
  const stages: ScanStageResult[] = []

  let redisPayload: ScanSessionRedisPayload = {
    scanSessionId,
    walletRef,
    createdAt,
    status: 'running',
    progress: 5,
    stages: [],
    updatedAt: nowIso(),
  }

  const persist = async (): Promise<void> => {
    if (!redis) {
      return
    }
    redisPayload = {
      ...redisPayload,
      updatedAt: nowIso(),
    }
    await saveScanSession(redis, scanSessionId, redisPayload, sessionTtlSeconds)
  }

  await persist()

  const [arkham, zerion, neynar] = await Promise.allSettled([
    promiseWithTimeout(
      withNoiseQueries({
        realAddress: address,
        query: fetchArkhamAddressIntelligence,
      }),
      providerTimeoutMs,
      'arkham'
    ),
    promiseWithTimeout(
      withNoiseQueries({
        realAddress: address,
        query: fetchZerionExposure,
      }),
      providerTimeoutMs,
      'zerion'
    ),
    promiseWithTimeout(
      withNoiseQueries({
        realAddress: address,
        query: fetchNeynarIdentity,
      }),
      providerTimeoutMs,
      'neynar'
    ),
  ])

  if (arkham.status === 'fulfilled' && neynar.status === 'fulfilled') {
    stages.push({ stage: 'identity', status: 'completed', progress: 40 })
  } else if (arkham.status === 'fulfilled' || neynar.status === 'fulfilled') {
    stages.push({ stage: 'identity', status: 'partial', progress: 30 })
  } else {
    stages.push({
      stage: 'identity',
      status: 'failed',
      progress: 20,
      error: [arkham, neynar]
        .filter(
          (entry): entry is PromiseRejectedResult => entry.status === 'rejected'
        )
        .map((entry) => getErrorMessage(entry.reason))
        .join('; '),
    })
  }

  redisPayload = {
    ...redisPayload,
    progress: 40,
    currentStage: currentStageFromStages(stages),
    stages: stages.map((s) => ({
      stage: s.stage,
      status: s.status,
      progress: s.progress,
      error: s.error,
    })),
  }
  await persist()

  if (zerion.status === 'fulfilled') {
    stages.push({ stage: 'financial', status: 'completed', progress: 70 })
  } else {
    stages.push({
      stage: 'financial',
      status: 'failed',
      progress: 55,
      error:
        zerion.status === 'rejected'
          ? getErrorMessage(zerion.reason)
          : 'zerion: unknown error',
    })
  }

  redisPayload = {
    ...redisPayload,
    progress: 70,
    currentStage: currentStageFromStages(stages),
    stages: stages.map((s) => ({
      stage: s.stage,
      status: s.status,
      progress: s.progress,
      error: s.error,
    })),
  }
  await persist()

  stages.push({
    stage: 'exchange',
    status: 'skipped',
    progress: 78,
    error: 'Exchange connector pending',
  })

  redisPayload = {
    ...redisPayload,
    progress: 78,
    currentStage: currentStageFromStages(stages),
    stages: stages.map((s) => ({
      stage: s.stage,
      status: s.status,
      progress: s.progress,
      error: s.error,
    })),
  }
  await persist()

  const successfulStages = stages.filter((s) => s.status === 'completed').length
  const finalStatus = successfulStages >= 2 ? 'completed' : 'partial'

  const arkhamData = arkham.status === 'fulfilled' ? arkham.value : undefined
  const zerionData = zerion.status === 'fulfilled' ? zerion.value : undefined
  const neynarData = neynar.status === 'fulfilled' ? neynar.value : undefined

  const privacy = computePrivacyScore({
    arkham: arkhamData,
    zerion: zerionData,
    neynar: neynarData,
  })

  const report = composeReport({
    privacy,
    arkham: arkhamData,
    zerion: zerionData,
    neynar: neynarData,
  })
  const supportedAssets = alphaSupportedAssets
  const nextActions = nextActionsBeforeEligibility()

  stages.push({
    stage: 'score',
    status: finalStatus === 'completed' ? 'completed' : 'partial',
    progress: 100,
  })

  redisPayload = {
    ...redisPayload,
    status: finalStatus === 'completed' ? 'completed' : 'partial',
    progress: 100,
    currentStage: currentStageFromStages(stages),
    stages: stages.map((s) => ({
      stage: s.stage,
      status: s.status,
      progress: s.progress,
      error: s.error,
    })),
    summary: {
      arkhamOk: Boolean(arkhamData),
      zerionOk: Boolean(zerionData),
      neynarOk: Boolean(neynarData),
      zerionTotalUsd: zerionData?.totalUsdVisible,
      privacyScore: privacy.score,
      privacyBand: privacy.band,
      privacyConfidence: privacy.confidence,
    },
    report,
    supportedAssets,
    nextActions,
  }
  await persist()

  return {
    scanSessionId,
    status: finalStatus,
    progress: 100,
    currentStage: currentStageFromStages(stages),
    stages,
    privacy,
    report,
    supportedAssets,
    nextActions,
    data: {
      arkham: arkhamData,
      zerion: zerionData,
      neynar: neynarData,
    },
  }
}
