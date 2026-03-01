'use client'

import { useState, useEffect } from 'react'
import Joyride, { CallBackProps, STATUS, Step } from 'react-joyride'

interface TutorialTourProps {
  tourId: string
  steps: Step[]
  run?: boolean
}

export function TutorialTour({ tourId, steps, run: runProp }: TutorialTourProps) {
  const [run, setRun] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)

  useEffect(() => {
    const hasSeenTour = localStorage.getItem(`tutorial_${tourId}`)
    if (!hasSeenTour && runProp !== false) {
      const timer = setTimeout(() => setRun(true), 500)
      return () => clearTimeout(timer)
    }
  }, [tourId, runProp])

  const handleCallback = (data: CallBackProps) => {
    const { status, index, type } = data

    if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
      localStorage.setItem(`tutorial_${tourId}`, 'true')
      setRun(false)
    }

    if (type === 'step:after') {
      setStepIndex(index + 1)
    }
  }

  return (
    <Joyride
      steps={steps}
      run={run}
      stepIndex={stepIndex}
      continuous
      showProgress
      showSkipButton
      callback={handleCallback}
      styles={{
        options: {
          primaryColor: '#7c3aed',
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
}

export function hasSeenTutorial(tourId: string): boolean {
  if (typeof window === 'undefined') return true
  return localStorage.getItem(`tutorial_${tourId}`) === 'true'
}
