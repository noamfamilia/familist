'use client'

import { useState, useEffect, useRef } from 'react'
import Joyride, { ACTIONS, CallBackProps, STATUS, Step } from 'react-joyride'

interface TutorialTourProps {
  tourId: string
  steps: Step[]
  run?: boolean
  onComplete?: () => void
  contentKey?: string | number // Changes when content changes to trigger re-check
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

const delayedAdvanceTargets: Record<string, string> = {
  '[data-tour="create-list"]': '[data-tour="list-card"]',
}

export function TutorialTour({ tourId, steps, run: runProp, onComplete, contentKey }: TutorialTourProps) {
  const [run, setRun] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
  const [filteredSteps, setFilteredSteps] = useState<Step[]>([])
  const prevStepsKey = useRef('')
  const prevContentKey = useRef<string | number | undefined>(undefined)
  const filteredStepsRef = useRef<Step[]>([])
  const waitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reanchorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const currentTargetRef = useRef<string | null>(null)
  const pendingTargetRef = useRef<string | null>(null)
  const hasStartedRef = useRef(false)

  const clearWaitTimer = () => {
    if (waitTimerRef.current) {
      clearTimeout(waitTimerRef.current)
      waitTimerRef.current = null
    }
  }

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
    const isFullyComplete = localStorage.getItem(`tutorial_${tourId}`) === 'true'
    
    if (isFullyComplete || runProp === false) {
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
    } else if (contentChanged && hasStartedRef.current && run) {
      // DOM nodes may have been replaced (e.g. optimistic→real ID key swap).
      // Toggle run so Joyride re-queries the CSS selector for the current target.
      if (reanchorTimerRef.current) clearTimeout(reanchorTimerRef.current)
      setRun(false)
      reanchorTimerRef.current = setTimeout(() => {
        reanchorTimerRef.current = null
        setRun(true)
      }, 50)
    }
  }, [tourId, runProp, steps, contentKey, run])

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
      const delayedTarget = currentTarget ? delayedAdvanceTargets[currentTarget] : null
      if (typeof delayedTarget === 'string') {
        waitForTargetAndAdvance(delayedTarget)
        return
      }

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
}

export function hasSeenTutorial(tourId: string): boolean {
  if (typeof window === 'undefined') return true
  return localStorage.getItem(`tutorial_${tourId}`) === 'true'
}
