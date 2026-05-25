'use client'

import { useState, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { createPortal } from 'react-dom'
import Joyride, { ACTIONS, CallBackProps, EVENTS, STATUS, Step } from 'react-joyride'
import { useHasMounted } from '@/hooks/useHasMounted'

interface TutorialTourProps {
  tourId: string
  steps: Step[]
  run?: boolean
  onComplete?: () => void
  contentKey?: string | number // Changes when content changes to trigger re-check
  /** Render Joyride on document.body (helps targets inside fixed overlays). */
  portalToBody?: boolean
  /** When false, Joyride adjusts spotlight position inside scrollable parents. */
  disableScrollParentFix?: boolean
}

const SHOW_TUTORIAL_SESSION_PREFIX = 'familist_run_tutorial_'
const SHOW_TUTORIAL_EVENT = 'familist:show-tutorial'

/** Survives React Strict Mode remounts within the same page load. */
const tutorialRunRequested = new Set<string>()

function isTutorialRunRequested(tourId: string): boolean {
  if (tutorialRunRequested.has(tourId)) return true
  if (typeof window === 'undefined') return false
  return sessionStorage.getItem(`${SHOW_TUTORIAL_SESSION_PREFIX}${tourId}`) === '1'
}

function markTutorialRunRequested(tourId: string) {
  tutorialRunRequested.add(tourId)
  if (typeof window !== 'undefined') {
    sessionStorage.setItem(`${SHOW_TUTORIAL_SESSION_PREFIX}${tourId}`, '1')
  }
}

function acknowledgeTutorialRunRequest(tourId: string) {
  tutorialRunRequested.add(tourId)
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem(`${SHOW_TUTORIAL_SESSION_PREFIX}${tourId}`)
  }
}

function clearTutorialRunRequest(tourId: string) {
  tutorialRunRequested.delete(tourId)
}

function getCompletedTargets(tourId: string): Set<string> {
  if (typeof window === 'undefined') return new Set()
  const stored = localStorage.getItem(`tutorial_${tourId}_targets`)
  return stored ? new Set(JSON.parse(stored)) : new Set()
}

function saveCompletedTargets(tourId: string, targets: Set<string>) {
  localStorage.setItem(`tutorial_${tourId}_targets`, JSON.stringify([...targets]))
}

function markTargetCompleted(tourId: string, target: string | null) {
  if (!target) return
  const completedTargets = getCompletedTargets(tourId)
  if (completedTargets.has(target)) return
  completedTargets.add(target)
  saveCompletedTargets(tourId, completedTargets)
}

function isTargetReady(target: string) {
  const element = document.querySelector(target)
  if (!element) return false

  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

function resetTourRuntimeState(args: {
  shouldRunRef: MutableRefObject<boolean>
  hasStartedRef: MutableRefObject<boolean>
  prevStepsKey: MutableRefObject<string>
  prevContentKey: MutableRefObject<string | number | undefined>
  pendingTargetRef: MutableRefObject<string | null>
  currentTargetRef: MutableRefObject<string | null>
  clearWaitTimer: () => void
  reanchorTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>
  setStepIndex: Dispatch<SetStateAction<number>>
  setRun: Dispatch<SetStateAction<boolean>>
  setFilteredSteps: Dispatch<SetStateAction<Step[]>>
}) {
  args.shouldRunRef.current = true
  args.hasStartedRef.current = false
  args.prevStepsKey.current = ''
  args.prevContentKey.current = undefined
  args.pendingTargetRef.current = null
  args.currentTargetRef.current = null
  args.clearWaitTimer()
  if (args.reanchorTimerRef.current) {
    clearTimeout(args.reanchorTimerRef.current)
    args.reanchorTimerRef.current = null
  }
  args.setStepIndex(0)
  args.setRun(false)
  args.setFilteredSteps([])
}

export function TutorialTour({
  tourId,
  steps,
  run: runProp,
  onComplete,
  contentKey,
  portalToBody = false,
  disableScrollParentFix = true,
}: TutorialTourProps) {
  const hasMounted = useHasMounted()
  const [run, setRun] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
  const [filteredSteps, setFilteredSteps] = useState<Step[]>([])
  const [restartNonce, setRestartNonce] = useState(0)
  const shouldRunRef = useRef(runProp === true)
  const prevStepsKey = useRef('')
  const prevContentKey = useRef<string | number | undefined>(undefined)
  const filteredStepsRef = useRef<Step[]>([])
  const waitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reanchorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const currentTargetRef = useRef<string | null>(null)
  const pendingTargetRef = useRef<string | null>(null)
  const hasStartedRef = useRef(false)
  const runRef = useRef(run)
  runRef.current = run

  const clearWaitTimer = () => {
    if (waitTimerRef.current) {
      clearTimeout(waitTimerRef.current)
      waitTimerRef.current = null
    }
  }

  useEffect(() => {
    const handleShowTutorial = () => {
      if (!isTutorialRunRequested(tourId)) return
      acknowledgeTutorialRunRequest(tourId)
      resetTourRuntimeState({
        shouldRunRef,
        hasStartedRef,
        prevStepsKey,
        prevContentKey,
        pendingTargetRef,
        currentTargetRef,
        clearWaitTimer,
        reanchorTimerRef,
        setStepIndex,
        setRun,
        setFilteredSteps,
      })
      setRestartNonce(n => n + 1)
    }

    window.addEventListener(SHOW_TUTORIAL_EVENT, handleShowTutorial)
    return () => window.removeEventListener(SHOW_TUTORIAL_EVENT, handleShowTutorial)
  }, [tourId])

  useEffect(() => {
    if (runProp === true || isTutorialRunRequested(tourId)) {
      acknowledgeTutorialRunRequest(tourId)
      shouldRunRef.current = true
    }
  }, [tourId, runProp, restartNonce])

  useEffect(() => {
    const isFullyComplete = localStorage.getItem(`tutorial_${tourId}`) === 'true'

    if (isFullyComplete || !shouldRunRef.current) {
      return
    }

    const completedTargets = getCompletedTargets(tourId)

    const availableSteps = steps.filter(step => {
      if (typeof step.target === 'string') {
        const notCompleted = !completedTargets.has(step.target)
        return isTargetReady(step.target) && notCompleted
      }
      return true
    })

    const stepsKey = availableSteps.map(s => s.target).join(',')

    const stepsChanged = stepsKey !== prevStepsKey.current
    const contentChanged = contentKey !== prevContentKey.current
    prevContentKey.current = contentKey

    if (availableSteps.length > 0 && stepsChanged) {
      prevStepsKey.current = stepsKey
      filteredStepsRef.current = availableSteps
      setFilteredSteps(availableSteps)
      clearWaitTimer()

      if (pendingTargetRef.current) {
        const pendingIndex = availableSteps.findIndex(
          step => typeof step.target === 'string' && step.target === pendingTargetRef.current
        )

        if (pendingIndex !== -1 && isTargetReady(pendingTargetRef.current)) {
          pendingTargetRef.current = null
          setStepIndex(pendingIndex)
          setRun(true)
        }
        return
      }

      if (hasStartedRef.current) {
        const currentTarget = currentTargetRef.current
        const currentIndex = currentTarget
          ? availableSteps.findIndex(
              step => typeof step.target === 'string' && step.target === currentTarget
            )
          : -1

        if (currentIndex !== -1) {
          setStepIndex(currentIndex)
        }
        setRun(false)
        requestAnimationFrame(() => setRun(true))
        return
      }

      setStepIndex(0)
      hasStartedRef.current = true
      setRun(true)
      return
    }

    if (contentChanged && hasStartedRef.current && runRef.current) {
      if (reanchorTimerRef.current) clearTimeout(reanchorTimerRef.current)
      setRun(false)
      reanchorTimerRef.current = setTimeout(() => {
        reanchorTimerRef.current = null
        setRun(true)
      }, 50)
      return
    }

    // Targets aren't in the DOM yet (e.g. tour mounted before async data loaded).
    // Poll so the tour can start once they render, without relying on contentKey churn.
    if (availableSteps.length === 0 && !runRef.current) {
      const hasIncompleteTargets = steps.some(step =>
        typeof step.target !== 'string' || !completedTargets.has(step.target)
      )
      if (!hasIncompleteTargets) return

      const timer = setTimeout(() => {
        setRestartNonce(n => n + 1)
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [tourId, runProp, steps, contentKey, restartNonce])

  useEffect(() => {
    filteredStepsRef.current = filteredSteps
  }, [filteredSteps])

  useEffect(() => {
    const currentStep = filteredSteps[stepIndex]
    currentTargetRef.current = typeof currentStep?.target === 'string' ? currentStep.target : null
  }, [filteredSteps, stepIndex])

  useEffect(() => {
    if (!run || !portalToBody) return

    let frame = 0
    const notifyResize = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        window.dispatchEvent(new Event('resize'))
      })
    }

    window.addEventListener('scroll', notifyResize, true)
  return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', notifyResize, true)
    }
  }, [run, portalToBody])

  useEffect(() => {
    return () => {
      clearWaitTimer()
      if (reanchorTimerRef.current) clearTimeout(reanchorTimerRef.current)
    }
  }, [])

  const handleCallback = (data: CallBackProps) => {
    const { status, index, type } = data

    if (type === EVENTS.STEP_BEFORE && portalToBody) {
      requestAnimationFrame(() => {
        window.dispatchEvent(new Event('resize'))
      })
    }

    if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
      const completedTargets = getCompletedTargets(tourId)
      filteredSteps.forEach(step => {
        if (typeof step.target === 'string') {
          completedTargets.add(step.target)
        }
      })
      saveCompletedTargets(tourId, completedTargets)

      if (completedTargets.size >= steps.length || status === STATUS.SKIPPED) {
        localStorage.setItem(`tutorial_${tourId}`, 'true')
      }

      setRun(false)
      clearWaitTimer()
      pendingTargetRef.current = null
      currentTargetRef.current = null
      hasStartedRef.current = false
      prevStepsKey.current = ''
      shouldRunRef.current = false
      clearTutorialRunRequest(tourId)
      onComplete?.()
    }

    if (type === 'step:after') {
      const nextIndex = index + (data.action === ACTIONS.PREV ? -1 : 1)

      if (data.action === ACTIONS.PREV) {
        setStepIndex(nextIndex)
        return
      }

      const currentStep = filteredSteps[index]
      const currentTarget = typeof currentStep?.target === 'string' ? currentStep.target : null
      markTargetCompleted(tourId, currentTarget)
      setStepIndex(nextIndex)
    }

    if (type === 'error:target_not_found') {
      setStepIndex(index + (data.action === ACTIONS.PREV ? -1 : 1))
    }
  }

  if (filteredSteps.length === 0) return null

  const joyride = (
    <Joyride
      steps={filteredSteps}
      run={run}
      stepIndex={stepIndex}
      continuous
      showSkipButton
      disableScrollParentFix={disableScrollParentFix}
      disableScrolling
      callback={handleCallback}
      styles={{
        options: {
          primaryColor: '#2aa198',
          zIndex: 10000,
        },
        tooltip: {
          borderRadius: 12,
          padding: 16,
        },
        buttonNext: {
          borderRadius: 8,
          padding: '8px 16px',
        },
        buttonBack: {
          borderRadius: 8,
          marginRight: 8,
        },
        buttonSkip: {
          borderRadius: 8,
        },
      }}
      locale={{
        back: 'Back',
        close: 'Close',
        last: 'Got it!',
        next: 'Next',
        skip: 'Skip tour',
      }}
    />
  )

  if (portalToBody && hasMounted) {
    return createPortal(joyride, document.body)
  }

  return joyride
}

export function resetTutorial(tourId: string) {
  localStorage.removeItem(`tutorial_${tourId}`)
  localStorage.removeItem(`tutorial_${tourId}_completed`)
  localStorage.removeItem(`tutorial_${tourId}_targets`)
  clearTutorialRunRequest(tourId)
}

/** Clears tutorial progress and starts home + list tours on the current page. */
export function requestShowTutorial() {
  if (typeof window === 'undefined') return
  resetTutorial('home')
  resetTutorial('list')
  markTutorialRunRequested('home')
  markTutorialRunRequested('list')
  window.dispatchEvent(new CustomEvent(SHOW_TUTORIAL_EVENT))
}

export function hasSeenTutorial(tourId: string): boolean {
  if (typeof window === 'undefined') return true
  return localStorage.getItem(`tutorial_${tourId}`) === 'true'
}
