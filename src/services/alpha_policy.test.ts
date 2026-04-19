import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createUnavailableRiskAssessment,
  deriveAlphaRiskAssessment,
  nextActionsForRisk,
} from './alpha_policy'

test('eligible wallets keep the migration flow enabled', () => {
  const assessment = deriveAlphaRiskAssessment({
    source: 'wavy',
    address: '0x1000000000000000000000000000000000000001',
    chainId: 421614,
    riskScore: 34,
    riskLevel: 'low',
    riskReason: 'Low-risk activity.',
    suspiciousActivity: false,
    patternsDetected: [],
    raw: {},
  })

  assert.equal(assessment.policyBand, 'eligible')
  assert.equal(assessment.migrationEligible, true)
  assert.equal(nextActionsForRisk(assessment)[0]?.intent, 'select_assets')
})

test('review band blocks migration and requests manual review', () => {
  const assessment = deriveAlphaRiskAssessment({
    source: 'wavy',
    address: '0x1000000000000000000000000000000000000001',
    chainId: 421614,
    riskScore: 67,
    riskLevel: 'high',
    riskReason: 'High-risk activity detected.',
    suspiciousActivity: true,
    patternsDetected: ['peel chain'],
    raw: {},
  })

  assert.equal(assessment.policyBand, 'review')
  assert.equal(assessment.migrationEligible, false)
  assert.equal(assessment.reviewRecommended, true)
  assert.equal(nextActionsForRisk(assessment)[0]?.intent, 'request_review')
})

test('unavailable scans fail closed', () => {
  const assessment = createUnavailableRiskAssessment(421614, 'Wavy timed out')

  assert.equal(assessment.available, false)
  assert.equal(assessment.policyBand, 'blocked')
  assert.equal(assessment.migrationEligible, false)
  assert.match(assessment.reason, /disabled/i)
})
