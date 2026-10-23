import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import './App.css'
import { mockQuestions } from './data/mockQuiz.ts'
import { createAttempt, createMockQuiz, formatDate, getIncorrectQuestions, getNextPendingQuestionIndex, scoreQuiz, validateNotes } from './lib/quiz.ts'
import { deleteSavedQuiz, loadSavedQuizzes, persistSavedQuizzes, readActiveAttempt, saveAttempt, writeActiveAttempt } from './lib/storage.ts'
import type { Quiz, QuizAttempt, QuizQuestion, QuizSettings, SavedQuiz } from './types.ts'

type Screen = 'create' | 'library' | 'quiz' | 'results'
const shouldFailHeroVideoForDemo = import.meta.env.DEV && new URLSearchParams(window.location.search).has('demoVideoFailure')
const heroVideoUrl = shouldFailHeroVideoForDemo ? '/missing-hero-video.mp4' : new URL('../videos/hero.mp4', import.meta.url).href
const defaults: QuizSettings = { questionCount: 5, difficulty: 'Medium', questionStyle: 'Mixed' }
const browserStorage = () => { try { return window.localStorage } catch { return null } }
const sessionStorage = () => { try { return window.sessionStorage } catch { return null } }

async function generateQuiz(notes: string, settings: QuizSettings): Promise<Quiz> {
  const response = await fetch('/api/generate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes, settings }),
  })
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(detail?.error || 'Quiz generation failed. Please try again.')
  }
  const result = await response.json() as { quiz?: Quiz }
  if (!result.quiz || !Array.isArray(result.quiz.questions)) throw new Error('The generation service returned an invalid quiz.')
  return result.quiz
}

function App() {
  const heroVideoRef = useRef<HTMLVideoElement>(null)
  const [screen, setScreen] = useState<Screen>('create')
  const [settings, setSettings] = useState(defaults)
  const [notes, setNotes] = useState('')
  const [attempt, setAttempt] = useState<QuizAttempt | null>(() => readActiveAttempt(sessionStorage()))
  const [saved, setSaved] = useState<SavedQuiz[]>(() => loadSavedQuizzes(browserStorage()).quizzes)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showExplanation, setShowExplanation] = useState(false)
  const [showSkippedQuestions, setShowSkippedQuestions] = useState(false)
  const [usingMock, setUsingMock] = useState(false)

  useEffect(() => { writeActiveAttempt(attempt, sessionStorage()) }, [attempt])
  useEffect(() => { persistSavedQuizzes(saved, browserStorage()) }, [saved])
  useEffect(() => {
    const video = heroVideoRef.current
    if (!video) return
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const syncPlayback = () => {
      if (reduceMotion.matches) {
        video.pause()
        video.style.visibility = 'hidden'
      } else {
        video.style.visibility = 'visible'
        void video.play().catch(() => { video.style.visibility = 'hidden' })
      }
    }
    syncPlayback()
    reduceMotion.addEventListener('change', syncPlayback)
    return () => reduceMotion.removeEventListener('change', syncPlayback)
  }, [])
  const question = attempt?.quiz.questions[attempt.currentIndex]
  const score = useMemo(() => attempt ? scoreQuiz(attempt.quiz.questions, attempt.selectedAnswers, attempt.submittedQuestionIds) : null, [attempt])

  function startQuiz(quiz: Quiz, opts: { previousScore?: number | null; mode?: QuizAttempt['mode']; savedQuizId?: string | null } = {}) {
    setAttempt(createAttempt(quiz, opts)); setScreen('quiz'); setShowExplanation(false); setShowSkippedQuestions(false); setError(''); setNotice('')
  }
  async function makeQuiz() {
    if (!Number.isInteger(settings.questionCount) || settings.questionCount < 1 || settings.questionCount > 100) {
      setError('Choose a whole number from 1 to 100 questions.')
      return
    }
    const validation = validateNotes(notes)
    if (validation) { setError(validation === 'empty' ? 'Add some notes or study material first.' : 'Your notes are too long. Keep them under 12,000 characters.'); return }
    setBusy(true); setError(''); setNotice(''); setUsingMock(false)
    try {
      const quiz = await generateQuiz(notes, settings)
      startQuiz(quiz)
    } catch (cause) {
      // Keep the prototype usable without API credentials or network access.
      if (cause instanceof TypeError || (cause instanceof Error && /fetch|network|not configured/i.test(cause.message))) {
        if (settings.questionCount > mockQuestions.length) {
          setError(`Sample mode has only ${mockQuestions.length} questions. Configure AI generation or request ${mockQuestions.length} or fewer questions.`)
          return
        }
        const mock = createMockQuiz(notes, settings)
        startQuiz(mock); setUsingMock(true)
      } else setError(cause instanceof Error ? cause.message : 'Could not create a quiz.')
    } finally { setBusy(false) }
  }
  function updateAttempt(change: (current: QuizAttempt) => QuizAttempt) { setAttempt(current => current ? change(current) : current) }
  function selectAnswer(index: number) {
    if (!question || showExplanation) return
    updateAttempt(current => ({ ...current, selectedAnswers: { ...current.selectedAnswers, [question.id]: index } }))
  }
  function submitAnswer() {
    if (!question || !attempt || attempt.selectedAnswers[question.id] === undefined) return
    const submitted = [...new Set([...attempt.submittedQuestionIds, question.id])]
    updateAttempt(current => ({ ...current, submittedQuestionIds: submitted, skippedQuestionIds: current.skippedQuestionIds.filter(id => id !== question.id) }))
    setShowExplanation(true)
  }
  function continueQuiz() {
    if (!attempt) return
    const nextIndex = getNextPendingQuestionIndex(attempt.quiz.questions, attempt.currentIndex, attempt.submittedQuestionIds, attempt.skippedQuestionIds)
    if (nextIndex !== null) {
      updateAttempt(current => ({ ...current, currentIndex: nextIndex })); setShowExplanation(false)
    } else setScreen('results')
  }
  function skipQuestion() {
    if (!attempt || !question) return
    const skipped = [...new Set([...attempt.skippedQuestionIds, question.id])]
    const nextIndex = getNextPendingQuestionIndex(attempt.quiz.questions, attempt.currentIndex, attempt.submittedQuestionIds, skipped)
    updateAttempt(current => ({ ...current, skippedQuestionIds: skipped, ...(nextIndex === null ? {} : { currentIndex: nextIndex }) }))
    setShowExplanation(false)
    if (nextIndex === null) setScreen('results')
  }
  function chooseSkippedQuestion(id: string) {
    if (!attempt) return
    const index = attempt.quiz.questions.findIndex(item => item.id === id && attempt.skippedQuestionIds.includes(id))
    if (index < 0) return
    updateAttempt(current => ({ ...current, currentIndex: index }))
    setShowExplanation(false)
    setShowSkippedQuestions(false)
    setScreen('quiz')
  }
  function openSkippedQuestions() {
    setShowSkippedQuestions(true)
    setShowExplanation(false)
    setScreen('quiz')
  }
  function finishAndSave() {
    if (!attempt || !score) return
    setSaved(current => saveAttempt(current, attempt, score.percentage))
    setNotice('Quiz saved to your library.')
  }
  function clearAttempt() { setAttempt(null); writeActiveAttempt(null, sessionStorage()) }
  function retry() {
    if (!attempt) return
    const currentScore = score?.percentage ?? 0
    const quiz = attempt.quiz
    const id = saved.some(item => item.id === quiz.id) ? quiz.id : null
    startQuiz(quiz, { previousScore: currentScore, savedQuizId: id })
  }
  function reviewMistakes() {
    if (!attempt || !score) return
    const mistakes = getIncorrectQuestions(attempt)
    if (!mistakes.length) return
    const quiz = { ...attempt.quiz, questions: mistakes }
    startQuiz(quiz, { previousScore: score.percentage, mode: 'mistakes', savedQuizId: attempt.savedQuizId })
  }
  const goLibrary = () => { setScreen('library'); setError(''); setNotice('') }

  return <div className="app-shell">
    <header className="topbar"><button className="brand" onClick={() => setScreen('create')} aria-label="Examlyra home"><span className="brand-mark">E</span><span>Examlyra</span></button><nav><button className={screen === 'create' ? 'nav-link active' : 'nav-link'} onClick={() => setScreen('create')}>Create quiz</button><button className={screen === 'library' ? 'nav-link active' : 'nav-link'} onClick={goLibrary}>My library <span className="count">{saved.length}</span></button></nav><div className="avatar">S</div></header>
    <main>
      {screen === 'create' && <section className="workspace">
        <div className="page-heading hero-heading"><video ref={heroVideoRef} className="hero-background-video" muted loop playsInline preload="metadata" aria-hidden="true" tabIndex={-1}><source src={heroVideoUrl} type="video/mp4"/></video><div className="hero-video-overlay" aria-hidden="true"/><div className="hero-copy"><p className="eyebrow">YOUR PERSONAL STUDY SPACE</p><h1>Turn your notes into<br/><span>exam-ready practice.</span></h1><p className="subheading">Build confidence with focused quizzes made from your own study material.</p></div><div className="heading-art" aria-hidden="true"><div className="art-glow"/><div className="art-orbit"/><div className="quiz-visual-card"><div className="visual-header"><span>QUICK PRACTICE</span><i>01 / 05</i></div><b className="visual-question">Which choice best supports active recall?</b><div className="visual-option"><i>A</i><span>Reread the same page</span></div><div className="visual-option chosen"><i>✓</i><span>Try to remember unaided</span></div><div className="visual-progress"><i/></div></div><div className="notes-chip"><span>✎</span><div><small>FROM YOUR NOTES</small><b>3 key ideas</b></div></div><div className="ready-chip"><span>✦</span><small>READY TO PRACTICE</small></div><div className="art-spark">✦</div></div></div>
        {attempt && <button className="resume-banner" onClick={() => setScreen('quiz')}><span className="resume-icon">↗</span><span><b>Pick up where you left off</b><small>{attempt.quiz.title} · Question {attempt.currentIndex + 1} of {attempt.quiz.questions.length}</small></span><span className="resume-arrow">→</span></button>}
        <div className="create-grid"><section className="panel source-panel"><div className="section-title"><div className="step">01</div><div><h2>What are you studying?</h2><p>Paste your notes, a chapter, or any study material.</p></div></div><label className="sr-only" htmlFor="notes">Study material</label><textarea id="notes" value={notes} onChange={event => { setNotes(event.target.value); setError('') }} maxLength={12000} placeholder={'Paste your study material here…\n\nThe more detail you include, the more tailored your questions will be.'}/><div className="textarea-footer"><span>✦ Saved quizzes stay in this browser only</span><span className={notes.length > 11000 ? 'char-count warn' : 'char-count'}>{notes.length.toLocaleString()} / 12,000</span></div><div className="settings-row"><label>NUMBER OF QUESTIONS<input type="number" min={1} max={100} step={1} value={settings.questionCount} aria-describedby="question-count-hint" onChange={event => setSettings(s => ({ ...s, questionCount: Number(event.target.value) }))}/><small id="question-count-hint">Choose 1–100. More questions need more detailed notes.</small></label><label>DIFFICULTY<select value={settings.difficulty} onChange={event => setSettings(s => ({ ...s, difficulty: event.target.value as QuizSettings['difficulty'] }))}><option>Easy</option><option>Medium</option><option>Hard</option></select></label><div className="question-style-setting"><label htmlFor="question-style">QUESTION STYLE</label><select id="question-style" value={settings.questionStyle} aria-describedby="question-style-guide" onChange={event => setSettings(s => ({ ...s, questionStyle: event.target.value as QuizSettings['questionStyle'] }))}><option>Mixed</option><option>Factual recall</option><option>Conceptual understanding</option><option>Application</option></select><details className="style-guide" id="question-style-guide"><summary>What do these styles mean?</summary><ul><li><strong>Mixed:</strong> a blend of fact, concept, and application questions.</li><li><strong>Factual recall:</strong> remember names, dates, terms, and other details.</li><li><strong>Conceptual understanding:</strong> explain ideas and how they relate.</li><li><strong>Application:</strong> use what you learned to solve a new example.</li></ul></details></div></div>
        {error && <p className="alert error" role="alert">{error}</p>}{notice && <p className="alert success" role="status">{notice}</p>}
        <button className="primary-button generate-button" onClick={makeQuiz} disabled={busy || !notes.trim()}>{busy ? <><span className="spinner"/> Building your quiz…</> : <>Generate my quiz <span>✦</span></>}</button><p className="fine-print">Usually takes about 15 seconds</p></section>
          <aside className="side-column"><div className="tip-card"><div className="tip-icon">✦</div><p className="eyebrow">A LITTLE STUDY TIP</p><h3>Test yourself<br/>before you peek.</h3><p>Active recall helps move what you learn into long-term memory. Give each question your best shot.</p><span className="tip-decoration">✳</span></div><button className="library-teaser" onClick={goLibrary}><span className="library-icon">▤</span><span><b>Your quiz library</b><small>{saved.length ? `${saved.length} saved ${saved.length === 1 ? 'quiz' : 'quizzes'}` : 'Your saved quizzes live here'}</small></span><span className="teaser-arrow">→</span></button><p className="mock-hint">New here? Try the demo with any notes. If the AI service isn’t configured, a sample quiz will open instead.</p></aside></div>
      </section>}

      {screen === 'library' && <section className="content-page"><div className="page-toolbar"><div><p className="eyebrow">YOUR STUDY COLLECTION</p><h1>Quiz library<span className="heading-period">.</span></h1><p className="subheading">Saved quizzes stay in this browser only. Clearing its data may remove them.</p></div><button className="primary-button compact" onClick={() => setScreen('create')}>＋ Create a quiz</button></div>{saved.length === 0 ? <div className="empty-state"><div className="empty-illustration">▤</div><h2>A little empty in here.</h2><p>Save a quiz after finishing it and it’ll be waiting for your next study session.</p><button className="secondary-button" onClick={() => setScreen('create')}>Make your first quiz →</button></div> : <div className="quiz-list">{saved.map(item => <article className="saved-card" key={item.id}><div className="saved-icon">✳</div><div className="saved-main"><h2>{item.title}</h2><p>{item.questions.length} questions <span>·</span> {item.settings.difficulty} <span>·</span> Saved {formatDate(item.createdAt)}</p><div className="saved-stats"><span>↻ {item.attemptCount} {item.attemptCount === 1 ? 'attempt' : 'attempts'}</span><span>Last score <b>{item.lastScore ?? '—'}{item.lastScore !== null ? '%' : ''}</b></span><span>Best <b>{item.bestScore ?? '—'}{item.bestScore !== null ? '%' : ''}</b></span></div></div><div className="saved-actions"><button className="primary-button compact" onClick={() => startQuiz(item, { previousScore: item.lastScore, savedQuizId: item.id })}>Study again →</button><button className="text-button danger-text" onClick={() => { setSaved(current => deleteSavedQuiz(current, item.id)); if (attempt?.savedQuizId === item.id) updateAttempt(current => ({ ...current, savedQuizId: null })) }}>Remove</button></div></article>)}</div>}</section>}

      {screen === 'quiz' && attempt && question && <QuizView attempt={attempt} question={question} showExplanation={showExplanation} showSkippedQuestions={showSkippedQuestions} usingMock={usingMock} onSelect={selectAnswer} onSubmit={submitAnswer} onSkip={skipQuestion} onContinue={continueQuiz} onExit={() => setScreen('create')} onToggleSkipped={() => setShowSkippedQuestions(value => !value)} onChooseSkipped={chooseSkippedQuestion}/>}
      {screen === 'results' && attempt && score && <ResultsView attempt={attempt} score={score} saved={saved.some(item => item.id === attempt.quiz.id)} onSave={finishAndSave} onReview={reviewMistakes} onRetry={retry} onLibrary={goLibrary} onResumeSkipped={openSkippedQuestions} onHome={() => { clearAttempt(); setScreen('create') }} onNotice={setNotice} notice={notice}/>}
    </main><footer className="footer"><span>Examlyra <span className="footer-dot">✦</span> Turn your notes into exam-ready practice.</span><span>Made for your next exam</span></footer>
  </div>
}

function QuizView({ attempt, question, showExplanation, showSkippedQuestions, usingMock, onSelect, onSubmit, onSkip, onContinue, onExit, onToggleSkipped, onChooseSkipped }: { attempt: QuizAttempt; question: QuizQuestion; showExplanation: boolean; showSkippedQuestions: boolean; usingMock: boolean; onSelect: (index: number) => void; onSubmit: () => void; onSkip: () => void; onContinue: () => void; onExit: () => void; onToggleSkipped: () => void; onChooseSkipped: (id: string) => void }) {
  const selected = attempt.selectedAnswers[question.id]
  const visitedCount = new Set([...attempt.submittedQuestionIds, ...attempt.skippedQuestionIds]).size
  const progress = (visitedCount / attempt.quiz.questions.length) * 100
  const skippedQuestions = attempt.quiz.questions.filter(item => attempt.skippedQuestionIds.includes(item.id))

  return <section className="quiz-page">
    <div className="quiz-top"><button className="back-button" onClick={onExit}>← <span>Exit quiz</span></button><div className="quiz-meta"><span className="mode-pill">{attempt.mode === 'mistakes' ? 'MISTAKE REVIEW' : 'STUDY SESSION'}</span><span>{attempt.quiz.title}</span></div><span className="question-count">{attempt.currentIndex + 1}<i> / </i>{attempt.quiz.questions.length}</span></div>
    <div className="progress-track"><span style={{ width: `${progress}%` }}/></div>
    {usingMock && <div className="demo-notice">Demo quiz · AI generation can be enabled with the server configuration.</div>}
    {skippedQuestions.length > 0 && <div className="skipped-question-menu"><button className="text-button" onClick={onToggleSkipped} aria-expanded={showSkippedQuestions}>See skipped questions ({skippedQuestions.length})</button>{showSkippedQuestions && <ul>{skippedQuestions.map(item => <li key={item.id}><button onClick={() => onChooseSkipped(item.id)}>{item.question}</button></li>)}</ul>}</div>}
    <div className="question-wrap">
      <div className="question-kicker"><span>QUESTION {String(attempt.currentIndex + 1).padStart(2, '0')}</span><span className={`difficulty ${question.difficulty.toLowerCase()}`}>{question.difficulty}</span></div>
      <h1>{question.question}</h1><p className="choose-hint">Choose the best answer</p>
      <div className="answer-list">{question.options.map((option, index) => { const isCorrect = showExplanation && index === question.correctAnswer; const isWrong = showExplanation && index === selected && !isCorrect; return <button key={`${question.id}-${index}`} className={`answer-option${selected === index ? ' selected' : ''}${isCorrect ? ' correct' : ''}${isWrong ? ' incorrect' : ''}`} onClick={() => onSelect(index)} disabled={showExplanation}><span className="option-letter">{String.fromCharCode(65 + index)}</span><span>{option}</span>{isCorrect && <span className="answer-mark">✓</span>}{isWrong && <span className="answer-mark">×</span>}</button>})}</div>
      {showExplanation && <div className={`explanation ${selected === question.correctAnswer ? 'right' : 'wrong'}`}><div className="explanation-icon">{selected === question.correctAnswer ? '✓' : '↗'}</div><div><b>{selected === question.correctAnswer ? 'That’s right!' : 'Not quite — here’s why'}</b><p>{question.explanation}</p><small>From your notes · {question.sourceReference}</small></div></div>}
      <div className="question-actions"><div className="question-action-buttons">{showExplanation ? <button className="primary-button" onClick={onContinue}>{getNextPendingQuestionIndex(attempt.quiz.questions, attempt.currentIndex, attempt.submittedQuestionIds, attempt.skippedQuestionIds) === null ? 'See my results' : 'Next question'} <span>→</span></button> : <><button className="primary-button" onClick={onSubmit} disabled={selected === undefined}>Check answer <span>→</span></button><button className="text-button skip-question-button" onClick={onSkip}>Skip for now</button></>}</div><span>{attempt.submittedQuestionIds.length} answered</span></div>
    </div>
    <p className="quiz-encouragement">One question at a time. You’ve got this <span>✦</span></p>
  </section>
}
function ResultsView({ attempt, score, saved, onSave, onReview, onRetry, onLibrary, onResumeSkipped, onHome, onNotice, notice }: { attempt: QuizAttempt; score: ReturnType<typeof scoreQuiz>; saved: boolean; onSave: () => void; onReview: () => void; onRetry: () => void; onLibrary: () => void; onResumeSkipped: () => void; onHome: () => void; onNotice: (text: string) => void; notice: string }) {
  const [details, setDetails] = useState(true)
  const missed = attempt.quiz.questions.length - attempt.submittedQuestionIds.length
  const mistakes = getIncorrectQuestions(attempt)
  const [copied, setCopied] = useState(false)
  return <section className="results-page"><div className="results-header"><div><p className="eyebrow">SESSION COMPLETE</p><h1>{score.percentage >= 80 ? 'Nicely recalled.' : score.percentage >= 50 ? 'You’re getting there.' : 'A good place to start.'}</h1><p className="subheading">{attempt.quiz.title} · {attempt.mode === 'mistakes' ? 'Mistake review' : 'Study session'}</p></div><div className="score-dial" style={{ '--score': `${score.percentage}%` } as CSSProperties}><div><b>{score.percentage}<small>%</small></b><span>YOUR SCORE</span></div></div></div><div className="score-stats"><div><b>{score.correct}</b><span>Correct</span></div><div><b>{score.incorrect}</b><span>Incorrect</span></div><div><b>{missed}</b><span>Skipped</span></div><div><b>{attempt.quiz.questions.length}</b><span>Total</span></div></div>{attempt.previousScore !== null && <p className="previous-score">Previous score: <b>{attempt.previousScore}%</b> {score.percentage >= attempt.previousScore ? '· You matched or beat it!' : '· Keep practicing!'}</p>}<div className="result-actions"><button className="primary-button" onClick={onRetry}>Try again <span>↻</span></button>{attempt.skippedQuestionIds.length > 0 && <button className="secondary-button" onClick={onResumeSkipped}>See skipped questions ({attempt.skippedQuestionIds.length})</button>}{mistakes.length > 0 && <button className="secondary-button" onClick={onReview}>Review {mistakes.length} {mistakes.length === 1 ? 'mistake' : 'mistakes'} →</button>}{saved && <button className="secondary-button" onClick={onLibrary}>Open library →</button>}{(!saved || attempt.mode === 'full') && <button className="secondary-button" onClick={onSave}>{saved ? 'Update saved score' : 'Save to library'} <span>{saved ? '↻' : '＋'}</span></button>}<button className="text-button" onClick={onHome}>Back to notes</button></div>{notice && <p className="alert success" role="status">{notice}</p>}<div className="review-heading"><div><p className="eyebrow">QUESTION BY QUESTION</p><h2>Review your answers</h2></div><button className="text-button" onClick={() => setDetails(value => !value)}>{details ? 'Collapse all' : 'Expand all'} {details ? '−' : '+'}</button></div><div className="review-list">{attempt.quiz.questions.map((item, index) => { const answered = attempt.submittedQuestionIds.includes(item.id); const answer = attempt.selectedAnswers[item.id]; const correct = answered && answer === item.correctAnswer; return <article className="review-item" key={item.id}><div className="review-row"><span className={`review-status ${correct ? 'good' : answered ? 'bad' : 'skipped'}`}>{correct ? '✓' : answered ? '×' : '–'}</span><span className="review-number">{String(index + 1).padStart(2, '0')}</span><b>{item.question}</b><button className="expand-button" onClick={() => setDetails(value => !value)} aria-label="Toggle explanation">{details ? '−' : '+'}</button></div>{details && <div className="review-detail"><p><span>Your answer</span>{answered ? item.options[answer] : 'Skipped'}</p><p className="correct-answer"><span>Correct answer</span>{item.options[item.correctAnswer]}</p><p className="review-explanation">{item.explanation}</p><small>From your notes · {item.sourceReference}</small></div>}</article>})}</div><button className="share-button" onClick={() => { const clipboard = navigator.clipboard; if (!clipboard) { onNotice('Clipboard access is unavailable in this browser.'); return } void clipboard.writeText(`I scored ${score.percentage}% on ${attempt.quiz.title} with Examlyra!`).then(() => { setCopied(true); onNotice('Score copied to clipboard.') }).catch(() => onNotice('Could not copy your score on this browser.')) }}>↗ {copied ? 'Copied!' : 'Share your progress'}</button></section>
}

export default App
