import { mockQuestions, withDifficulty } from '../data/mockQuiz.ts'
import type { Difficulty, Quiz, QuizAttempt, QuizQuestion, QuizSettings } from '../types.ts'

export const MAX_NOTES_LENGTH = 12_000

export interface QuizScore {
  correct: number
  incorrect: number
  answered: number
  missed: number
  total: number
  percentage: number
}

export function validateNotes(notes: string): 'empty' | 'too-long' | null {
  if (!notes.trim()) return 'empty'
  if (notes.length > MAX_NOTES_LENGTH) return 'too-long'
  return null
}

export function createMockQuiz(notes: string, settings: QuizSettings, now = new Date()): Quiz {
  const questions = mockQuestions
    .slice(0, settings.questionCount)
    .map((question) => withDifficulty(question, settings.difficulty))

  return {
    id: createId(),
    title: 'Cellular Respiration',
    createdAt: now.toISOString(),
    notes: notes.trim(),
    settings: { ...settings },
    questions,
  }
}

export function createAttempt(
  quiz: Quiz,
  options: {
    previousScore?: number | null
    mode?: QuizAttempt['mode']
    savedQuizId?: string | null
    random?: () => number
  } = {},
): QuizAttempt {
  return {
    attemptId: createId(),
    quiz: { ...quiz, questions: shuffleQuestions(quiz.questions, options.random) },
    currentIndex: 0,
    selectedAnswers: {},
    submittedQuestionIds: [],
    skippedQuestionIds: [],
    previousScore: options.previousScore ?? null,
    mode: options.mode ?? 'full',
    savedQuizId: options.savedQuizId ?? null,
  }
}

export function getNextPendingQuestionIndex(
  questions: QuizQuestion[],
  currentIndex: number,
  submittedQuestionIds: string[],
  skippedQuestionIds: string[],
): number | null {
  const submitted = new Set(submittedQuestionIds)
  const skipped = new Set(skippedQuestionIds)
  for (let step = 1; step < questions.length; step += 1) {
    const index = (currentIndex + step) % questions.length
    const question = questions[index]
    if (question && !submitted.has(question.id) && !skipped.has(question.id)) return index
  }
  return null
}

export function scoreQuiz(
  questions: QuizQuestion[],
  answers: Record<string, number>,
  submittedQuestionIds: string[],
): QuizScore {
  const submitted = new Set(submittedQuestionIds)
  const answeredQuestions = questions.filter((question) => submitted.has(question.id))
  const correct = answeredQuestions.filter(
    (question) => answers[question.id] === question.correctAnswer,
  ).length
  const total = questions.length

  return {
    correct,
    incorrect: answeredQuestions.length - correct,
    answered: answeredQuestions.length,
    missed: Math.max(0, total - answeredQuestions.length),
    total,
    percentage: total === 0 ? 0 : Math.round((correct / total) * 100),
  }
}

export function getIncorrectQuestions(attempt: QuizAttempt): QuizQuestion[] {
  const submitted = new Set(attempt.submittedQuestionIds)
  return attempt.quiz.questions.filter(
    (question) =>
      submitted.has(question.id) &&
      attempt.selectedAnswers[question.id] !== question.correctAnswer,
  )
}

export function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Date unavailable'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
}

export function shuffleQuestions<T>(questions: T[], random = Math.random): T[] {
  const shuffled = [...questions]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const otherIndex = Math.floor(random() * (index + 1))
    ;[shuffled[index], shuffled[otherIndex]] = [shuffled[otherIndex], shuffled[index]]
  }
  return shuffled
}

export function isQuestion(value: unknown): value is QuizQuestion {
  if (!value || typeof value !== 'object') return false
  const question = value as Partial<QuizQuestion>
  return (
    typeof question.id === 'string' &&
    typeof question.question === 'string' &&
    Array.isArray(question.options) &&
    question.options.length === 4 &&
    question.options.every((option) => typeof option === 'string') &&
    new Set(question.options).size === 4 &&
    Number.isInteger(question.correctAnswer) &&
    (question.correctAnswer ?? -1) >= 0 &&
    (question.correctAnswer ?? 4) < 4 &&
    typeof question.explanation === 'string' &&
    typeof question.sourceReference === 'string' &&
    isDifficulty(question.difficulty)
  )
}

export function isDifficulty(value: unknown): value is Difficulty {
  return value === 'Easy' || value === 'Medium' || value === 'Hard'
}

function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `quiz-${Date.now()}-${Math.random().toString(36).slice(2)}`
}
