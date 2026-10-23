import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createMockQuiz, getIncorrectQuestions, getNextPendingQuestionIndex, scoreQuiz, validateNotes } from './quiz.ts'
import { ACTIVE_ATTEMPT_KEY, deleteSavedQuiz, loadSavedQuizzes, persistSavedQuizzes, readActiveAttempt, saveAttempt, saveQuiz, SAVED_QUIZZES_KEY } from './storage.ts'
import type { QuizAttempt } from '../types.ts'

const settings = { questionCount: 5 as const, difficulty: 'Medium' as const, questionStyle: 'Mixed' as const }

function makeMemoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  }
}

describe('quiz logic', () => {
  it('validates empty and over-limit notes', () => {
    assert.equal(validateNotes('  '), 'empty')
    assert.equal(validateNotes('x'.repeat(12_001)), 'too-long')
    assert.equal(validateNotes('A short set of notes'), null)
  })

  it('scores submitted answers and tracks unanswered questions', () => {
    const quiz = createMockQuiz('sample notes', settings)
    const score = scoreQuiz(quiz.questions, { 'cell-q1': 0, 'cell-q2': 2 }, ['cell-q1', 'cell-q2'])
    assert.deepEqual(score, { correct: 1, incorrect: 1, answered: 2, missed: 3, total: 5, percentage: 20 })
  })

  it('returns only submitted incorrect questions for mistake review', () => {
    const quiz = createMockQuiz('sample notes', settings)
    const attempt: QuizAttempt = {
      attemptId: 'attempt-1',
      quiz,
      currentIndex: 1,
      selectedAnswers: { 'cell-q1': 1, 'cell-q2': 0 },
      submittedQuestionIds: ['cell-q1', 'cell-q2'],
      skippedQuestionIds: [],
      previousScore: null,
      mode: 'full',
      savedQuizId: null,
    }
    assert.deepEqual(getIncorrectQuestions(attempt).map((question) => question.id), ['cell-q1'])
  })

  it('finds the next unanswered, non-skipped question and returns none when only skipped questions remain', () => {
    const quiz = createMockQuiz('sample notes', settings)
    assert.equal(getNextPendingQuestionIndex(quiz.questions, 0, ['cell-q1'], ['cell-q2']), 2)
    assert.equal(getNextPendingQuestionIndex(quiz.questions, 0, ['cell-q1', 'cell-q3', 'cell-q4', 'cell-q5'], ['cell-q2']), null)
  })
})

describe('saved quiz storage', () => {
  it('saves a newly generated quiz to the browser library before it is attempted', () => {
    const storage = makeMemoryStorage()
    const quiz = createMockQuiz('sample notes', settings)
    const saved = saveQuiz([], quiz)
    assert.equal(saved.length, 1)
    assert.equal(saved[0]?.id, quiz.id)
    assert.equal(saved[0]?.attemptCount, 0)
    assert.equal(saved[0]?.lastScore, null)
    assert.equal(persistSavedQuizzes(saved, storage), true)
    assert.equal(loadSavedQuizzes(storage).quizzes[0]?.title, quiz.title)
    assert.equal(saveQuiz(saved, quiz).length, 1)
  })

  it('loads an older in-progress quiz without losing it when skipped questions are added', () => {
    const storage = makeMemoryStorage()
    const attempt = createAttemptForStorage()
    const olderAttempt = JSON.stringify(attempt, (key, value) => key === 'skippedQuestionIds' ? undefined : value)
    storage.setItem(ACTIVE_ATTEMPT_KEY, olderAttempt)
    assert.deepEqual(readActiveAttempt(storage)?.skippedQuestionIds, [])
  })

  it('saves, reloads, updates, and deletes a quiz record', () => {
    const storage = makeMemoryStorage()
    const quiz = createMockQuiz('sample notes', settings)
    const attempt: QuizAttempt = {
      attemptId: 'attempt-1',
      quiz,
      currentIndex: 4,
      selectedAnswers: Object.fromEntries(quiz.questions.map((question) => [question.id, question.correctAnswer])),
      submittedQuestionIds: quiz.questions.map((question) => question.id),
      skippedQuestionIds: [],
      previousScore: null,
      mode: 'full',
      savedQuizId: null,
    }
    const saved = saveAttempt([], attempt, 100)
    assert.equal(persistSavedQuizzes(saved, storage), true)
    assert.equal(storage.getItem(SAVED_QUIZZES_KEY)?.includes('"version":1'), true)
    assert.equal(loadSavedQuizzes(storage).quizzes[0]?.attemptCount, 1)
    assert.equal(loadSavedQuizzes(storage).quizzes[0]?.bestScore, 100)
    assert.deepEqual(deleteSavedQuiz(saved, quiz.id), [])
  })

  it('recovers safely from malformed localStorage data', () => {
    const storage = makeMemoryStorage({ [SAVED_QUIZZES_KEY]: '{broken' })
    assert.deepEqual(loadSavedQuizzes(storage), { quizzes: [], recovered: true })
  })
})

function createAttemptForStorage(): QuizAttempt {
  return {
    attemptId: 'attempt-legacy',
    quiz: createMockQuiz('sample notes', settings),
    currentIndex: 0,
    selectedAnswers: {},
    submittedQuestionIds: [],
    skippedQuestionIds: [],
    previousScore: null,
    mode: 'full',
    savedQuizId: null,
  }
}
