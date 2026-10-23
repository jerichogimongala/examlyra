import type { IncomingMessage, ServerResponse } from 'node:http'

export function handleGenerateRequest(request: IncomingMessage, response: ServerResponse, env?: NodeJS.ProcessEnv): Promise<void>
export function validateGenerationBody(body: unknown): string | null
export function generateQuiz(body: unknown, env?: NodeJS.ProcessEnv): Promise<{ status: number; body: Record<string, unknown> }>
