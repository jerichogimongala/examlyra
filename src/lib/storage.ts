import { isDifficulty, isQuestion } from './quiz.ts'
import type { QuizAttempt, QuizSettings, SavedQuiz } from '../types.ts'

export const SAVED_QUIZZES_KEY = 'recallkit_quizzes'
export const SAVED_QUIZZES_VERSION = 1
export const ACTIVE_ATTEMPT_KEY = 'recallkit_active_attempt'

export interface StoragePort {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface LoadSavedResult {
  quizzes: SavedQuiz[]
  recovered: boolean
}

export function loadSavedQuizzes(storage: StoragePort | null): LoadSavedResult {
  if (!storage) return { quizzes: [], recovered: false }

  try {
    const raw = storage.getItem(SAVED_QUIZZES_KEY)
    if (!raw) return { quizzes: [], recovered: false }
    const parsed: unknown = JSON.parse(raw)
    if (!isSavedQuizCollection(parsed)) return { quizzes: [], recovered: true }
    const quizzes = parsed.quizzes.filter(isSavedQuiz)
    return { quizzes, recovered: quizzes.length !== parsed.quizzes.length }
  } catch {
    return { quizzes: [], recovered: true }
  }
}

export function persistSavedQuizzes(quizzes: SavedQuiz[], storage: StoragePort | null): boolean {
  if (!storage) return false
  try {
    storage.setItem(
      SAVED_QUIZZES_KEY,
      JSON.stringify({ version: SAVED_QUIZZES_VERSION, quizzes }),
    )
    return true
  } catch {
    return false
  }
}

export function saveQuiz(current: SavedQuiz[], quiz: QuizAttempt['quiz']): SavedQuiz[] {
  if (current.some((item) => item.id === quiz.id)) return current
  const record: SavedQuiz = {
    ...quiz,
    bestScore: null,
    lastScore: null,
    attemptCount: 0,
    lastAnswers: {},
    lastSubmittedQuestionIds: [],
    lastAttemptId: null,
  }
  return [record, ...current]
}

export function saveAttempt(
  current: SavedQuiz[],
  attempt: QuizAttempt,
  score: number,
): SavedQuiz[] {
  const existing = current.find((quiz) => quiz.id === attempt.quiz.id)
  const record: SavedQuiz = {
    id: attempt.quiz.id,
    title: attempt.quiz.title,
    createdAt: existing?.createdAt ?? attempt.quiz.createdAt,
    notes: attempt.quiz.notes,
    settings: attempt.quiz.settings,
    questions: attempt.quiz.questions,
    bestScore: existing?.bestScore === null || existing?.bestScore === undefined
      ? score
      : Math.max(existing.bestScore, score),
    lastScore: score,
    attemptCount: (existing?.attemptCount ?? 0) + (existing?.lastAttemptId === attempt.attemptId ? 0 : 1),
    lastAnswers: { ...attempt.selectedAnswers },
    lastSubmittedQuestionIds: [...attempt.submittedQuestionIds],
    lastAttemptId: attempt.attemptId,
  }

  return [record, ...current.filter((quiz) => quiz.id !== record.id)]
}

export function deleteSavedQuiz(quizzes: SavedQuiz[], id: string): SavedQuiz[] {
  return quizzes.filter((quiz) => quiz.id !== id)
}

export function readActiveAttempt(storage: StoragePort | null): QuizAttempt | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(ACTIVE_ATTEMPT_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isQuizAttempt(parsed)) return null
    return { ...parsed, skippedQuestionIds: parsed.skippedQuestionIds ?? [] }
  } catch {
    return null
  }
}

export function writeActiveAttempt(attempt: QuizAttempt | null, storage: StoragePort | null): void {
  if (!storage) return
  try {
    if (attempt) storage.setItem(ACTIVE_ATTEMPT_KEY, JSON.stringify(attempt))
    else storage.removeItem(ACTIVE_ATTEMPT_KEY)
  } catch {
    // Session storage is optional; the current quiz still works without it.
  }
}

function isSavedQuizCollection(value: unknown): value is { version: number; quizzes: unknown[] } {
  return (
    !!value &&
    typeof value === 'object' &&
    'version' in value &&
    value.version === SAVED_QUIZZES_VERSION &&
    'quizzes' in value &&
    Array.isArray(value.quizzes)
  )
}

function isSettings(value: unknown): value is QuizSettings {
  if (!value || typeof value !== 'object') return false
  const settings = value as Partial<QuizSettings>
  return (
    typeof settings.questionCount === 'number' && Number.isInteger(settings.questionCount) &&
    settings.questionCount >= 1 && settings.questionCount <= 100 &&
    isDifficulty(settings.difficulty) &&
    (settings.questionStyle === 'Factual recall' ||
      settings.questionStyle === 'Conceptual understanding' ||
      settings.questionStyle === 'Application' ||
      settings.questionStyle === 'Mixed')
  )
}

function isSavedQuiz(value: unknown): value is SavedQuiz {
  if (!value || typeof value !== 'object') return false
  const quiz = value as Partial<SavedQuiz>
  return (
    typeof quiz.id === 'string' &&
    typeof quiz.title === 'string' &&
    typeof quiz.createdAt === 'string' &&
    typeof quiz.notes === 'string' &&
    isSettings(quiz.settings) &&
    Array.isArray(quiz.questions) &&
    quiz.questions.length > 0 &&
    quiz.questions.every(isQuestion) &&
    (quiz.bestScore === null || typeof quiz.bestScore === 'number') &&
    (quiz.lastScore === null || typeof quiz.lastScore === 'number') &&
    Number.isInteger(quiz.attemptCount) &&
    typeof quiz.lastAnswers === 'object' &&
    quiz.lastAnswers !== null &&
    Array.isArray(quiz.lastSubmittedQuestionIds) &&
    (quiz.lastAttemptId === null || typeof quiz.lastAttemptId === 'string')
  )
}

function isQuizAttempt(value: unknown): value is QuizAttempt {
  if (!value || typeof value !== 'object') return false
  const attempt = value as Partial<QuizAttempt>
  return (
    typeof attempt.attemptId === 'string' &&
    !!attempt.quiz &&
    typeof attempt.quiz === 'object' &&
    Array.isArray(attempt.quiz.questions) &&
    attempt.quiz.questions.every(isQuestion) &&
    Number.isInteger(attempt.currentIndex) &&
    typeof attempt.selectedAnswers === 'object' &&
    attempt.selectedAnswers !== null &&
    Array.isArray(attempt.submittedQuestionIds) &&
    (attempt.skippedQuestionIds === undefined || Array.isArray(attempt.skippedQuestionIds)) &&
    (attempt.mode === 'full' || attempt.mode === 'mistakes')
  )
}
