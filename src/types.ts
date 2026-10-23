export type Difficulty = 'Easy' | 'Medium' | 'Hard'

export type QuestionStyle =
  | 'Factual recall'
  | 'Conceptual understanding'
  | 'Application'
  | 'Mixed'

export interface QuizSettings {
  questionCount: number
  difficulty: Difficulty
  questionStyle: QuestionStyle
}

export interface QuizQuestion {
  id: string
  question: string
  options: string[]
  correctAnswer: number
  explanation: string
  difficulty: Difficulty
  sourceReference: string
}

export interface Quiz {
  id: string
  title: string
  createdAt: string
  notes: string
  settings: QuizSettings
  questions: QuizQuestion[]
}

export interface QuizAttempt {
  attemptId: string
  quiz: Quiz
  currentIndex: number
  selectedAnswers: Record<string, number>
  submittedQuestionIds: string[]
  skippedQuestionIds: string[]
  previousScore: number | null
  mode: 'full' | 'mistakes'
  savedQuizId: string | null
}

export interface SavedQuiz {
  id: string
  title: string
  createdAt: string
  notes: string
  settings: QuizSettings
  questions: QuizQuestion[]
  bestScore: number | null
  lastScore: number | null
  attemptCount: number
  lastAnswers: Record<string, number>
  lastSubmittedQuestionIds: string[]
  lastAttemptId: string | null
}
