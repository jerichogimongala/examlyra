import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { generateQuiz, handleGenerateRequest, validateGenerationBody } from './generate.mjs'
import { createGenerationRateLimiter, getGenerationClientId } from './rate-limit.mjs'

const valid = { notes: 'Photosynthesis converts light energy into chemical energy.', settings: { questionCount: 5, difficulty: 'Medium', questionStyle: 'Mixed' } }

describe('generation API validation', () => {
  it('requires useful notes and valid settings', () => {
    assert.match(validateGenerationBody({ ...valid, notes: '  ' }), /study notes/)
    assert.match(validateGenerationBody({ ...valid, notes: 'x'.repeat(12_001) }), /12,000/)
    assert.match(validateGenerationBody({ ...valid, settings: { ...valid.settings, questionCount: 0 } }), /1 to 100/)
    assert.match(validateGenerationBody({ ...valid, settings: { ...valid.settings, questionCount: 101 } }), /1 to 100/)
    assert.equal(validateGenerationBody({ ...valid, settings: { ...valid.settings, questionCount: 1 } }), null)
    assert.equal(validateGenerationBody({ ...valid, settings: { ...valid.settings, questionCount: 100 } }), null)
    assert.equal(validateGenerationBody(valid), null)
  })

  it('returns a clear configuration error without calling a provider', async () => {
    const result = await generateQuiz(valid, {})
    assert.equal(result.status, 503)
    assert.match(result.body.error, /GEMINI_API_KEY/)
  })

  it('normalizes a valid provider response into a quiz', async () => {
    const originalFetch = globalThis.fetch
    let apiKeyHeader = ''
    let requestUrl = ''
    const questions = Array.from({ length: 5 }, (_, index) => ({
      question: `Question ${index + 1}?`, options: ['A', 'B', 'C', 'D'], correctAnswer: 0,
      explanation: 'Because the notes say so.', difficulty: 'Medium', sourceReference: 'Topic',
    }))
    globalThis.fetch = async (url, options) => {
      requestUrl = String(url)
      apiKeyHeader = options.headers['x-goog-api-key']
      return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ title: 'Photosynthesis', questions, insufficientNotes: false, message: '' }) }] } }] }), { status: 200 })
    }
    try {
      const result = await generateQuiz(valid, { GEMINI_API_KEY: 'server-only-secret' })
      assert.equal(result.status, 200)
      assert.equal(result.body.quiz.title, 'Photosynthesis')
      assert.equal(result.body.quiz.questions.length, 5)
      assert.equal(result.body.quiz.questions[0].id.endsWith('-1'), true)
      assert.match(requestUrl, /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-3\.8-flash:generateContent/)
      assert.equal(apiKeyHeader, 'server-only-secret')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('explains when notes cannot support the requested number of questions', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => new Response(JSON.stringify({
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ title: 'Photosynthesis', questions: [], insufficientNotes: true, message: 'Not enough detail.' }) }] } }],
    }), { status: 200 })
    try {
      const result = await generateQuiz(valid, { GEMINI_API_KEY: 'server-only-secret' })
      assert.equal(result.status, 422)
      assert.match(result.body.error, /isn't enough detail/)
      assert.match(result.body.error, /5 distinct questions/)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('limits both requests and requested question volume within a window', () => {
    let time = 1_000
    const limiter = createGenerationRateLimiter({ requestLimit: 3, questionLimit: 5, windowMs: 60_000, now: () => time })
    assert.equal(limiter.check('client-a', 3).allowed, true)
    assert.equal(limiter.check('client-a', 3).allowed, false)
    assert.equal(limiter.check('client-b', 3).allowed, true)
    assert.equal(limiter.check('client-b', 1).allowed, true)
    assert.equal(limiter.check('client-b', 1).allowed, true)
    assert.equal(limiter.check('client-b', 1).allowed, false)
    time += 60_000
    assert.equal(limiter.check('client-a', 5).allowed, true)
  })

  it('applies an aggregate daily cap across client addresses', () => {
    let time = Date.parse('2026-10-23T10:00:00.000Z')
    const limiter = createGenerationRateLimiter({ dailyRequestLimit: 2, dailyQuestionLimit: 3, now: () => time })
    assert.equal(limiter.check('client-a', 2).allowed, true)
    assert.equal(limiter.check('client-b', 1).allowed, true)
    assert.equal(limiter.check('client-c', 1).reason, 'daily')
    time = Date.parse('2026-10-24T00:00:00.000Z')
    assert.equal(limiter.check('client-c', 1).allowed, true)
  })

  it('uses the socket address unless a configured trusted proxy header contains a valid IP', () => {
    const request = { socket: { remoteAddress: '192.0.2.10' }, headers: { 'x-forwarded-for': '198.51.100.2, 192.0.2.1' } }
    assert.equal(getGenerationClientId(request, {}), '192.0.2.10')
    assert.equal(getGenerationClientId(request, { TRUSTED_CLIENT_IP_HEADER: 'x-forwarded-for' }), '198.51.100.2')
    assert.equal(getGenerationClientId({ ...request, headers: { 'x-forwarded-for': 'bad-value' } }, { TRUSTED_CLIENT_IP_HEADER: 'x-forwarded-for' }), '192.0.2.10')
  })

  it('rejects non-JSON and rate-limited endpoint requests before provider calls', async () => {
    const call = async ({ contentType = 'application/json', limiter, questionCount = 1 }) => {
      const request = {
        method: 'POST', headers: { 'content-type': contentType }, socket: { remoteAddress: '192.0.2.55' },
        async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ ...valid, settings: { ...valid.settings, questionCount } })) },
      }
      const response = {
        status: 0, headers: {}, body: '',
        writeHead(status, headers) { this.status = status; this.headers = headers },
        end(body) { this.body = body ?? '' },
      }
      await handleGenerateRequest(request, response, {}, limiter)
      return response
    }

    const noLimit = createGenerationRateLimiter()
    assert.equal((await call({ contentType: 'text/plain', limiter: noLimit })).status, 415)
    const limitOnce = createGenerationRateLimiter({ requestLimit: 1, questionLimit: 100 })
    assert.equal((await call({ limiter: limitOnce })).status, 503)
    const limited = await call({ limiter: limitOnce })
    assert.equal(limited.status, 429)
    assert.ok(Number(limited.headers['Retry-After']) > 0)
  })

  it('returns provider quota/rate limit errors without disguising them as server failures', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => new Response('{}', { status: 429 })
    try {
      const result = await generateQuiz(valid, { GEMINI_API_KEY: 'server-only-secret' })
      assert.equal(result.status, 429)
      assert.match(result.body.error, /billing and limits/)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
