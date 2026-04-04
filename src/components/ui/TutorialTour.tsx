'use client'

import { useState, useEffect, useRef } from 'react'
import Joyride, { CallBackProps, STATUS, Step } from 'react-joyride'

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

export function TutorialTour({ tourId, steps, run: runProp, onComplete, contentKey }: TutorialTourProps) {
  const [run, setRun] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
  const [filteredSteps, setFilteredSteps] = useState<Step[]>([])
  const prevStepsKey = useRef('')

  useEffect(() => {
    const isFullyComplete = localStorage.getItem(`tutorial_${tourId}`) === 'true'
    
    if (isFullyComplete || runProp === false) {
      return
    }

    const completedTargets = getCompletedTargets(tourId)

    // Filter steps: target exists in DOM AND hasn't been completed
    const availableSteps = steps.filter(step => {
      if (typeof step.target === 'string') {
        const exists = document.querySelector(step.target) !== null
        const notCompleted = !completedTargets.has(step.target)
        return exists && notCompleted
      }
      return true
    })
    
    // Create a key to detect changes in available steps
    const stepsKey = availableSteps.map(s => s.target).join(',')
    
    if (availableSteps.length > 0 && stepsKey !== prevStepsKey.current) {
      prevStepsKey.current = stepsKey
      setFilteredSteps(availableSteps)
      setStepIndex(0)
      const timer = setTimeout(() => setRun(true), 500)
      return () => clearTimeout(timer)
    }
  }, [tourId, runProp, steps, contentKey])

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
      prevStepsKey.current = ''
      onComplete?.()
    }

    if (type === 'step:after') {
      setStepIndex(index + 1)
    }
  }

  if (filteredSteps.length === 0) return null

  return (
    <Joyride
      steps={filteredSteps}
      run={run}
      stepIndex={stepIndex}
      continuous
      showProgress
      showSkipButton
      disableScrollParentFix
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
