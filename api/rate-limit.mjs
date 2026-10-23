import { isIP } from 'node:net'

const DEFAULT_WINDOW_MS = 60_000
const DEFAULT_REQUEST_LIMIT = 5
const DEFAULT_QUESTION_LIMIT = 100
const DEFAULT_DAILY_REQUEST_LIMIT = 50
const DEFAULT_DAILY_QUESTION_LIMIT = 500
const MAX_CLIENTS = 10_000

function positiveInteger(value, fallback) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function createGenerationRateLimiter({
  windowMs = DEFAULT_WINDOW_MS,
  requestLimit = DEFAULT_REQUEST_LIMIT,
  questionLimit = DEFAULT_QUESTION_LIMIT,
  dailyRequestLimit = DEFAULT_DAILY_REQUEST_LIMIT,
  dailyQuestionLimit = DEFAULT_DAILY_QUESTION_LIMIT,
  now = Date.now,
  maxClients = MAX_CLIENTS,
} = {}) {
  const clients = new Map()
  let daily = { day: '', requests: 0, questions: 0 }

  return {
    check(clientId, questionCount) {
      const time = now()
      const day = new Date(time).toISOString().slice(0, 10)
      if (daily.day !== day) daily = { day, requests: 0, questions: 0 }
      if (daily.requests + 1 > dailyRequestLimit || daily.questions + questionCount > dailyQuestionLimit) {
        const nextUtcDay = Date.parse(`${day}T00:00:00.000Z`) + 86_400_000
        return { allowed: false, reason: 'daily', retryAfter: Math.max(1, Math.ceil((nextUtcDay - time) / 1000)) }
      }
      let entry = clients.get(clientId)
      if (!entry || time - entry.startedAt >= windowMs) {
        if (!entry && clients.size >= maxClients) {
          for (const [id, client] of clients) {
            if (time - client.startedAt >= windowMs) clients.delete(id)
          }
          if (clients.size >= maxClients) return { allowed: false, reason: 'capacity', retryAfter: Math.max(1, Math.ceil(windowMs / 1000)) }
        }
        entry = { startedAt: time, requests: 0, questions: 0 }
        clients.set(clientId, entry)
      }

      if (entry.requests + 1 > requestLimit || entry.questions + questionCount > questionLimit) {
        return { allowed: false, reason: 'client', retryAfter: Math.max(1, Math.ceil((entry.startedAt + windowMs - time) / 1000)) }
      }

      entry.requests += 1
      entry.questions += questionCount
      daily.requests += 1
      daily.questions += questionCount
      return {
        allowed: true,
        remaining: Math.min(requestLimit - entry.requests, questionLimit - entry.questions),
        retryAfter: Math.max(1, Math.ceil((entry.startedAt + windowMs - time) / 1000)),
      }
    },
  }
}

export function generationRateLimitConfig(env = process.env) {
  return {
    windowMs: positiveInteger(env.API_RATE_LIMIT_WINDOW_MS, DEFAULT_WINDOW_MS),
    requestLimit: positiveInteger(env.API_RATE_LIMIT_REQUESTS, DEFAULT_REQUEST_LIMIT),
    questionLimit: positiveInteger(env.API_RATE_LIMIT_QUESTIONS, DEFAULT_QUESTION_LIMIT),
    dailyRequestLimit: positiveInteger(env.API_DAILY_REQUESTS, DEFAULT_DAILY_REQUEST_LIMIT),
    dailyQuestionLimit: positiveInteger(env.API_DAILY_QUESTIONS, DEFAULT_DAILY_QUESTION_LIMIT),
  }
}

const clientIpHeaders = new Set(['x-real-ip', 'cf-connecting-ip', 'x-forwarded-for'])

export function getGenerationClientId(request, env = process.env) {
  const trustedHeader = env.TRUSTED_CLIENT_IP_HEADER?.toLowerCase()
  if (clientIpHeaders.has(trustedHeader)) {
    const candidate = request.headers?.[trustedHeader]
    const address = Array.isArray(candidate) ? candidate[0] : candidate?.split(',')[0]?.trim()
    if (address && isIP(address)) return address
  }
  return request.socket?.remoteAddress || 'unknown-client'
}
