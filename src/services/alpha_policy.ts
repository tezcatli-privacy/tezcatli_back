import type { WavyRiskLevel, WavyRiskScan } from './connectors/wavy.connector'

export type AlphaAssetKind = 'erc20' | 'wrapped_native'
export type AlphaMigrationRoute = 'direct' | 'wrap_then_migrate'

export type AlphaSupportedAsset = {
  symbol: 'USDC' | 'USDT' | 'WBTC' | 'WETH'
  displaySymbol: 'USDC' | 'USDT' | 'WBTC' | 'ETH'
  name: string
  kind: AlphaAssetKind
  migrationRoute: AlphaMigrationRoute
  description: string
}

export type AlphaNextAction = {
  id: string
  label: string
  intent:
    | 'connect_wallet'
    | 'scan_wallet'
    | 'request_migration_eligibility'
    | 'select_assets'
    | 'migrate_assets'
    | 'open_smart_account'
    | 'deposit_to_vault'
    | 'buy_gold'
    | 'continue_later'
    | 'request_review'
  enabled: boolean
}

export type AlphaRiskAssessment = {
  available: boolean
  provider: 'wavy'
  chainId: number
  score?: number
  level: WavyRiskLevel | 'unavailable'
  suspiciousActivity: boolean
  migrationEligible: boolean
  reviewRecommended: boolean
  policyBand: 'eligible' | 'review' | 'blocked'
  reason: string
  riskReason?: string
  failureReason?: string
  analysisId?: string
  patternsDetected: string[]
  transactionsAnalyzed?: number
  completedAt?: string
}

export const alphaSupportedAssets: AlphaSupportedAsset[] = [
  {
    symbol: 'USDC',
    displaySymbol: 'USDC',
    name: 'USD Coin',
    kind: 'erc20',
    migrationRoute: 'direct',
    description: 'Stablecoin path with direct shielding into the confidential stack.',
  },
  {
    symbol: 'USDT',
    displaySymbol: 'USDT',
    name: 'Tether USD',
    kind: 'erc20',
    migrationRoute: 'direct',
    description: 'Stablecoin path supported for alpha migrations.',
  },
  {
    symbol: 'WBTC',
    displaySymbol: 'WBTC',
    name: 'Wrapped Bitcoin',
    kind: 'erc20',
    migrationRoute: 'direct',
    description: 'Bitcoin exposure routed as ERC-20 during the alpha.',
  },
  {
    symbol: 'WETH',
    displaySymbol: 'ETH',
    name: 'Wrapped Ether',
    kind: 'wrapped_native',
    migrationRoute: 'wrap_then_migrate',
    description: 'ETH is represented as WETH until native-ETH migration exists.',
  },
]

const buildEligibleActions = (): AlphaNextAction[] => [
  { id: 'select-assets', label: 'Select Assets', intent: 'select_assets', enabled: true },
  { id: 'migrate-assets', label: 'Migrate Assets', intent: 'migrate_assets', enabled: true },
  { id: 'open-smart-account', label: 'Open Smart Account', intent: 'open_smart_account', enabled: true },
  { id: 'deposit-vault', label: 'Deposit To Vault', intent: 'deposit_to_vault', enabled: true },
  { id: 'buy-gold', label: 'Buy Gold', intent: 'buy_gold', enabled: true },
  { id: 'continue-later', label: 'Continue Later', intent: 'continue_later', enabled: true },
]

export const nextActionsBeforeEligibility = (): AlphaNextAction[] => [
  {
    id: 'request-migration-eligibility',
    label: 'I want to migrate my wallet',
    intent: 'request_migration_eligibility',
    enabled: true,
  },
  { id: 'continue-later', label: 'Continue Later', intent: 'continue_later', enabled: true },
]

const buildReviewActions = (): AlphaNextAction[] => [
  { id: 'request-review', label: 'Request Review', intent: 'request_review', enabled: true },
  { id: 'continue-later', label: 'Continue Later', intent: 'continue_later', enabled: true },
]

const buildBlockedActions = (): AlphaNextAction[] => [
  { id: 'continue-later', label: 'Continue Later', intent: 'continue_later', enabled: true },
]

export const createUnavailableRiskAssessment = (
  chainId: number,
  failureReason: string
): AlphaRiskAssessment => ({
  available: false,
  provider: 'wavy',
  chainId,
  level: 'unavailable',
  suspiciousActivity: false,
  migrationEligible: false,
  reviewRecommended: false,
  policyBand: 'blocked',
  reason:
    'Risk analysis is unavailable right now. Migration stays disabled until the wallet can be scanned.',
  failureReason,
  patternsDetected: [],
})

export const deriveAlphaRiskAssessment = (
  scan: WavyRiskScan
): AlphaRiskAssessment => {
  if (scan.riskScore >= 80) {
    return {
      available: true,
      provider: 'wavy',
      chainId: scan.chainId,
      score: scan.riskScore,
      level: scan.riskLevel,
      suspiciousActivity: scan.suspiciousActivity,
      migrationEligible: false,
      reviewRecommended: false,
      policyBand: 'blocked',
      reason:
        'This wallet falls in the blocked risk band for alpha migrations.',
      riskReason: scan.riskReason,
      analysisId: scan.analysisId,
      patternsDetected: scan.patternsDetected,
      transactionsAnalyzed: scan.transactionsAnalyzed,
      completedAt: scan.completedAt,
    }
  }

  if (scan.riskScore >= 60) {
    return {
      available: true,
      provider: 'wavy',
      chainId: scan.chainId,
      score: scan.riskScore,
      level: scan.riskLevel,
      suspiciousActivity: scan.suspiciousActivity,
      migrationEligible: false,
      reviewRecommended: true,
      policyBand: 'review',
      reason:
        'This wallet requires manual review before the alpha migration flow can be unlocked.',
      riskReason: scan.riskReason,
      analysisId: scan.analysisId,
      patternsDetected: scan.patternsDetected,
      transactionsAnalyzed: scan.transactionsAnalyzed,
      completedAt: scan.completedAt,
    }
  }

  return {
    available: true,
    provider: 'wavy',
    chainId: scan.chainId,
    score: scan.riskScore,
    level: scan.riskLevel,
    suspiciousActivity: scan.suspiciousActivity,
    migrationEligible: true,
    reviewRecommended: false,
    policyBand: 'eligible',
    reason: 'This wallet is eligible for the alpha migration flow.',
    riskReason: scan.riskReason,
    analysisId: scan.analysisId,
    patternsDetected: scan.patternsDetected,
    transactionsAnalyzed: scan.transactionsAnalyzed,
    completedAt: scan.completedAt,
  }
}

export const nextActionsForRisk = (
  risk: AlphaRiskAssessment
): AlphaNextAction[] => {
  if (risk.policyBand === 'eligible') {
    return buildEligibleActions()
  }
  if (risk.policyBand === 'review') {
    return buildReviewActions()
  }
  return buildBlockedActions()
}

const riskCatalog: Array<{
  min: number
  max: number
  level: WavyRiskLevel
  recommendedAction: string
}> = [
  { min: 0, max: 0, level: 'verified', recommendedAction: 'Verified legitimate entity' },
  { min: 1, max: 19, level: 'minimal', recommendedAction: 'No action needed' },
  { min: 20, max: 39, level: 'low', recommendedAction: 'Passive monitoring' },
  { min: 40, max: 59, level: 'medium', recommendedAction: 'Investigation recommended' },
  { min: 60, max: 79, level: 'high', recommendedAction: 'Priority investigation' },
  { min: 80, max: 100, level: 'critical', recommendedAction: 'Immediate action / regulatory report' },
]

const randomIntInclusive = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1)) + min

export const createMockWavyRiskScan = (
  address: string,
  chainId: number
): WavyRiskScan => {
  const catalogIndex = randomIntInclusive(0, riskCatalog.length - 1)
  const selected = riskCatalog[Math.min(catalogIndex, riskCatalog.length - 1)]!

  const score = randomIntInclusive(selected.min, selected.max)

  return {
    source: 'wavy',
    address,
    chainId,
    riskScore: score,
    riskLevel: selected.level,
    riskReason: `Alpha mock risk score aligned to Wavy bands. Recommended action: ${selected.recommendedAction}.`,
    suspiciousActivity: score >= 70,
    patternsDetected: score >= 80 ? ['simulated-critical-pattern'] : score >= 60 ? ['simulated-high-pattern'] : [],
    transactionsAnalyzed: 0,
    completedAt: new Date().toISOString(),
    raw: {
      mode: 'mock',
      recommendedAction: selected.recommendedAction,
    },
  }
}
