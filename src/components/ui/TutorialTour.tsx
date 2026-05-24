'use client'

import { useState, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import Joyride, { ACTIONS, CallBackProps, STATUS, Step } from 'react-joyride'

interface TutorialTourProps {
  tourId: string
  steps: Step[]
  run?: boolean
  onComplete?: () => void
  contentKey?: string | number // Changes when content changes to trigger re-check
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

// Get completed targets from localStorage
function getCompletedTargets(tourId: string): Set<string> {
  if (typeof window === 'undefined') return new Set()
  const stored = localStorage.getItem(`tutorial_${tourId}_targets`)
  return stored ? new Set(JSON.parse(stored)) : new Set()
}

// Save completed targets to localStorage
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

export function TutorialTour({ tourId, steps, run: runProp, onComplete, contentKey }: TutorialTourProps) {
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

  const waitForTargetAndAdvance = (target: string, attempt = 0) => {
    clearWaitTimer()
    pendingTargetRef.current = target
    setRun(false)

    if (!isTargetReady(target)) {
      if (attempt >= 40) return

      waitTimerRef.current = setTimeout(() => {
        waitForTargetAndAdvance(target, attempt + 1)
      }, 150)
      return
    }

    const nextIndex = filteredStepsRef.current.findIndex(
      step => typeof step.target === 'string' && step.target === target
    )

    if (nextIndex !== -1) {
      pendingTargetRef.current = null
      setStepIndex(nextIndex)
      setRun(true)
    }
  }

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

    // Filter steps: target exists in DOM AND hasn't been completed
    const availableSteps = steps.filter(step => {
      if (typeof step.target === 'string') {
        const notCompleted = !completedTargets.has(step.target)
        return isTargetReady(step.target) && notCompleted
      }
      return true
    })

    // Create a key to detect changes in available steps
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
    } else if (contentChanged && hasStartedRef.current && runRef.current) {
      // DOM nodes may have been replaced (e.g. optimistic→real ID key swap).
      // Toggle run so Joyride re-queries the CSS selector for the current target.
      if (reanchorTimerRef.current) clearTimeout(reanchorTimerRef.current)
      setRun(false)
      reanchorTimerRef.current = setTimeout(() => {
        reanchorTimerRef.current = null
        setRun(true)
      }, 50)
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
    return () => {
      clearWaitTimer()
      if (reanchorTimerRef.current) clearTimeout(reanchorTimerRef.current)
    }
  }, [])

  const handleCallback = (data: CallBackProps) => {
    const { status, index, type } = data

    if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
      // Mark shown steps as completed by their target
      const completedTargets = getCompletedTargets(tourId)
      filteredSteps.forEach(step => {
        if (typeof step.target === 'string') {
          completedTargets.add(step.target)
        }
      })
      saveCompletedTargets(tourId, completedTargets)

      // Check if all steps have been completed or skipped
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

  return (
    <Joyride
      steps={filteredSteps}
      run={run}
      stepIndex={stepIndex}
      continuous
      showSkipButton
      disableScrollParentFix
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
