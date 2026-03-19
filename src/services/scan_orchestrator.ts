import crypto from 'node:crypto'
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

type ScanStage = 'identity' | 'financial' | 'exchange' | 'score'
type StageStatus = 'completed' | 'partial' | 'failed' | 'skipped'

type ScanStageResult = {
  stage: ScanStage
  status: StageStatus
  progress: number
  error?: string
}

export type ScanResult = {
  scanSessionId: string
  status: 'completed' | 'partial'
  progress: number
  stages: ScanStageResult[]
  data: {
    arkham?: ArkhamFinding
    zerion?: ZerionExposure
    neynar?: NeynarIdentity
  }
}

const getErrorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : 'Unknown error'

export const runScanOrchestrator = async (address: string): Promise<ScanResult> => {
  const scanSessionId = crypto.randomUUID()
  const stages: ScanStageResult[] = []

  const [arkham, zerion, neynar] = await Promise.allSettled([
    fetchArkhamAddressIntelligence(address),
    fetchZerionExposure(address),
    fetchNeynarIdentity(address),
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
        .filter((entry) => entry.status === 'rejected')
        .map((entry) => getErrorMessage(entry.reason))
        .join('; '),
    })
  }

  if (zerion.status === 'fulfilled') {
    stages.push({ stage: 'financial', status: 'completed', progress: 70 })
  } else {
    stages.push({
      stage: 'financial',
      status: 'failed',
      progress: 55,
      error: getErrorMessage(zerion.reason),
    })
  }

  stages.push({
    stage: 'exchange',
    status: 'skipped',
    progress: 85,
    error: 'Exchange connector pending',
  })

  const successfulStages = stages.filter((s) => s.status === 'completed').length
  const finalStatus = successfulStages >= 2 ? 'completed' : 'partial'

  stages.push({
    stage: 'score',
    status: finalStatus === 'completed' ? 'completed' : 'partial',
    progress: 100,
  })

  return {
    scanSessionId,
    status: finalStatus,
    progress: 100,
    stages,
    data: {
      arkham: arkham.status === 'fulfilled' ? arkham.value : undefined,
      zerion: zerion.status === 'fulfilled' ? zerion.value : undefined,
      neynar: neynar.status === 'fulfilled' ? neynar.value : undefined,
    },
  }
}
