import type { Redis } from 'ioredis'

export type RemediationEvent = 'report_to_cta_click' | 'cta_to_stage2_start'

const analyticsKey = 'tezcatli:analytics:remediation'

const eventField = (event: RemediationEvent): string => `event:${event}`

export const trackRemediationEvent = async (
  redis: Redis,
  event: RemediationEvent
): Promise<void> => {
  await redis.hincrby(analyticsKey, eventField(event), 1)
  await redis.hincrby(analyticsKey, 'event:total', 1)
}

