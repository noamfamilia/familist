'use client'

import { useState, useEffect, useRef } from 'react'
import Joyride, { CallBackProps, STATUS, Step } from 'react-joyride'

interface TutorialTourProps {
  tourId: string
  steps: Step[]
  run?: boolean
  onComplete?: () => void
  listsExist?: boolean // Trigger to check for new available steps
}

export function TutorialTour({ tourId, steps, run: runProp, onComplete, listsExist }: TutorialTourProps) {
  const [run, setRun] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
  const [filteredSteps, setFilteredSteps] = useState<Step[]>([])
  const prevAvailableCount = useRef(0)

  useEffect(() => {
    // Get completed step count from localStorage
    const completedCount = parseInt(localStorage.getItem(`tutorial_${tourId}_completed`) || '0', 10)
    const isFullyComplete = localStorage.getItem(`tutorial_${tourId}`) === 'true'
    
    if (isFullyComplete && runProp !== false) {
      // Tour was fully completed, don't show again
      return
    }

    // Filter steps to only include those with existing targets
    const availableSteps = steps.filter(step => {
      if (typeof step.target === 'string') {
        return document.querySelector(step.target) !== null
      }
      return true
    })
    
    // Check if there are new steps available beyond what we've completed
    if (availableSteps.length > completedCount && runProp !== false) {
      // Get only the steps we haven't shown yet
      const remainingSteps = availableSteps.slice(completedCount)
      
      if (remainingSteps.length > 0 && remainingSteps.length !== prevAvailableCount.current) {
        prevAvailableCount.current = remainingSteps.length
        setFilteredSteps(remainingSteps)
        setStepIndex(0)
        const timer = setTimeout(() => setRun(true), 500)
        return () => clearTimeout(timer)
      }
    }
  }, [tourId, runProp, steps, listsExist])

  const handleCallback = (data: CallBackProps) => {
    const { status, index, type } = data
    const completedCount = parseInt(localStorage.getItem(`tutorial_${tourId}_completed`) || '0', 10)

    if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
      // Update completed count
      const newCompletedCount = completedCount + filteredSteps.length
      localStorage.setItem(`tutorial_${tourId}_completed`, newCompletedCount.toString())
      
      // Check if we've shown all steps
      const allAvailableSteps = steps.filter(step => {
        if (typeof step.target === 'string') {
          return document.querySelector(step.target) !== null
        }
        return true
      })
      
      if (newCompletedCount >= steps.length || status === STATUS.SKIPPED) {
        // All steps shown or skipped, mark as fully complete
        localStorage.setItem(`tutorial_${tourId}`, 'true')
      }
      
      setRun(false)
      prevAvailableCount.current = 0
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
}

export function hasSeenTutorial(tourId: string): boolean {
  if (typeof window === 'undefined') return true
  return localStorage.getItem(`tutorial_${tourId}`) === 'true'
}
