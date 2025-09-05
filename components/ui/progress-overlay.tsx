'use client'

import React from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { XIcon, CheckIcon, AlertCircleIcon, LoaderIcon } from 'lucide-react'

export interface ProgressStep {
  id: string
  label: string
  status: 'pending' | 'running' | 'completed' | 'error'
  details?: string
  errorMessage?: string
}

interface ProgressOverlayProps {
  isOpen: boolean
  onClose: () => void
  title: string
  steps: ProgressStep[]
  currentStep?: string
  overallProgress: number // 0-100
  canCancel?: boolean
  onCancel?: () => void
  isCompleted?: boolean
  totalItems?: number
  processedItems?: number
}

export function ProgressOverlay({
  isOpen,
  onClose,
  title,
  steps,
  // currentStep,
  overallProgress,
  canCancel = false,
  onCancel,
  isCompleted = false,
  totalItems,
  processedItems
}: ProgressOverlayProps) {
  const getStepIcon = (step: ProgressStep) => {
    switch (step.status) {
      case 'completed':
        return <CheckIcon className="h-4 w-4 text-green-600" />
      case 'error':
        return <AlertCircleIcon className="h-4 w-4 text-red-600" />
      case 'running':
        return <LoaderIcon className="h-4 w-4 text-blue-600 animate-spin" />
      default:
        return <div className="h-4 w-4 rounded-full border-2 border-gray-300" />
    }
  }

  const getStepTextClass = (step: ProgressStep) => {
    switch (step.status) {
      case 'completed':
        return 'text-green-700'
      case 'error':
        return 'text-red-700'
      case 'running':
        return 'text-blue-700 font-medium'
      default:
        return 'text-gray-500'
    }
  }

  const hasErrors = steps.some(step => step.status === 'error')

  return (
    <Dialog open={isOpen} onOpenChange={canCancel || isCompleted ? onClose : undefined}>
      <DialogContent className="max-w-lg" onPointerDownOutside={(e) => {
        if (!canCancel && !isCompleted) {
          e.preventDefault()
        }
      }}>
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              {!isCompleted && !hasErrors && (
                <LoaderIcon className="h-5 w-5 text-blue-600 animate-spin" />
              )}
              {isCompleted && !hasErrors && (
                <CheckIcon className="h-5 w-5 text-green-600" />
              )}
              {hasErrors && (
                <AlertCircleIcon className="h-5 w-5 text-red-600" />
              )}
              {title}
            </DialogTitle>
            {canCancel && !isCompleted && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                className="h-6 w-6 p-0"
              >
                <XIcon className="h-4 w-4" />
              </Button>
            )}
          </div>
        </DialogHeader>

        <div className="space-y-4">
          {/* Overall Progress Bar */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Overall Progress</span>
              <span className="text-gray-900 font-medium">{Math.round(overallProgress)}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${overallProgress}%` }}
              />
            </div>
            {totalItems && (
              <div className="text-xs text-gray-500 text-center">
                {processedItems || 0} of {totalItems} items processed
              </div>
            )}
          </div>

          {/* Step List */}
          <div className="space-y-3">
            {steps.map((step) => (
              <div key={step.id} className="flex items-start gap-3">
                <div className="flex-shrink-0 mt-0.5">
                  {getStepIcon(step)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`text-sm ${getStepTextClass(step)}`}>
                    {step.label}
                  </div>
                  {step.details && (
                    <div className="text-xs text-gray-500 mt-1">
                      {step.details}
                    </div>
                  )}
                  {step.errorMessage && (
                    <div className="text-xs text-red-600 mt-1">
                      Error: {step.errorMessage}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end gap-2 pt-4 border-t">
            {canCancel && !isCompleted && onCancel && (
              <Button
                variant="outline"
                size="sm"
                onClick={onCancel}
                className="text-red-600 hover:text-red-700 hover:bg-red-50"
              >
                Cancel Operation
              </Button>
            )}
            {isCompleted && (
              <Button size="sm" onClick={onClose}>
                {hasErrors ? 'Close' : 'Done'}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// Hook for managing progress state
export function useProgressTracking() {
  const [isOpen, setIsOpen] = React.useState(false)
  const [title, setTitle] = React.useState('')
  const [steps, setSteps] = React.useState<ProgressStep[]>([])
  const [overallProgress, setOverallProgress] = React.useState(0)
  const [totalItems, setTotalItems] = React.useState<number | undefined>()
  const [processedItems, setProcessedItems] = React.useState<number | undefined>()
  const [isCompleted, setIsCompleted] = React.useState(false)

  const startProgress = (title: string, initialSteps: ProgressStep[], totalItems?: number) => {
    setTitle(title)
    setSteps(initialSteps)
    setOverallProgress(0)
    setTotalItems(totalItems)
    setProcessedItems(0)
    setIsCompleted(false)
    setIsOpen(true)
  }

  const updateStep = (stepId: string, updates: Partial<ProgressStep>) => {
    setSteps(prev => prev.map(step => 
      step.id === stepId ? { ...step, ...updates } : step
    ))
  }

  const updateProgress = (progress: number, processedCount?: number) => {
    setOverallProgress(progress)
    if (processedCount !== undefined) {
      setProcessedItems(processedCount)
    }
  }

  const completeProgress = () => {
    setIsCompleted(true)
    setOverallProgress(100)
  }

  const closeProgress = () => {
    setIsOpen(false)
    // Reset state after close animation
    setTimeout(() => {
      setSteps([])
      setOverallProgress(0)
      setTotalItems(undefined)
      setProcessedItems(undefined)
      setIsCompleted(false)
    }, 300)
  }

  return {
    isOpen,
    title,
    steps,
    overallProgress,
    totalItems,
    processedItems,
    isCompleted,
    startProgress,
    updateStep,
    updateProgress,
    completeProgress,
    closeProgress
  }
}
