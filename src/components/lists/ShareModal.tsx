'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { forceNewClient } from '@/lib/supabase/client'
import type { List } from '@/lib/supabase/types'

interface ShareModalProps {
  isOpen: boolean
  onClose: () => void
  list: List
  onUpdate: () => void
}

export function ShareModal({ isOpen, onClose, list, onUpdate }: ShareModalProps) {
  const [visibility, setVisibility] = useState<'private' | 'link'>(list.visibility)
  const [token, setToken] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  // Only reset state when modal opens, not when list object reference changes
  useEffect(() => {
    if (isOpen) {
      setVisibility(list.visibility)
      setToken('')
      setCopied(false)
      
      // If already link-enabled, generate a new token to display
      if (list.visibility === 'link') {
        generateToken()
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const generateToken = async () => {
    setLoading(true)
    try {
      const supabase = forceNewClient()
      const { data, error } = await supabase.rpc('generate_share_token', {
        p_list_id: list.id,
      })
      if (error) throw error
      setToken(data)
    } catch (err) {
      console.error('Error generating token:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleVisibilityChange = async (newVisibility: 'private' | 'link') => {
    if (newVisibility === 'link') {
      setVisibility('link')
      await generateToken()
      onUpdate()
    } else {
      setLoading(true)
      try {
        const supabase = forceNewClient()
        const { error } = await supabase.rpc('revoke_share_token', {
          p_list_id: list.id,
        })

        if (error) throw error
        setToken('')
        setVisibility('private')
        onUpdate()
      } catch (err) {
        console.error('Error updating visibility:', err)
      } finally {
        setLoading(false)
      }
    }
  }

  const handleCopyToken = async () => {
    if (!token) return
    
    try {
      await navigator.clipboard.writeText(token)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement('textarea')
      textArea.value = token
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Share Settings">
      <p className="text-center text-gray-500 font-medium mb-5">{list.name}</p>

      <div className="space-y-3 mb-5">
        {/* Private option */}
        <label className="cursor-pointer block">
          <input
            type="radio"
            name="visibility"
            value="private"
            checked={visibility === 'private'}
            onChange={() => handleVisibilityChange('private')}
            disabled={loading}
            className="sr-only"
          />
          <div className={`flex items-center gap-3 p-4 border-2 rounded-lg transition-all ${
            visibility === 'private' 
              ? 'border-primary bg-primary-light' 
              : 'border-gray-200 hover:bg-gray-50'
          }`}>
            <span className="text-2xl">🔒</span>
            <div>
              <div className="font-semibold">Private</div>
              <div className="text-sm text-gray-500">Only you can access this list</div>
            </div>
          </div>
        </label>

        {/* Link-enabled option */}
        <label className="cursor-pointer block">
          <input
            type="radio"
            name="visibility"
            value="link"
            checked={visibility === 'link'}
            onChange={() => handleVisibilityChange('link')}
            disabled={loading}
            className="sr-only"
          />
          <div className={`flex items-center gap-3 p-4 border-2 rounded-lg transition-all ${
            visibility === 'link' 
              ? 'border-primary bg-primary-light' 
              : 'border-gray-200 hover:bg-gray-50'
          }`}>
            <span className="text-2xl">🔗</span>
            <div>
              <div className="font-semibold">Link-enabled</div>
              <div className="text-sm text-gray-500">Anyone with the token can join</div>
            </div>
          </div>
        </label>
      </div>

      {/* Token section */}
      {visibility === 'link' && token && (
        <div className="pt-4 border-t border-gray-200">
          <label className="text-sm text-gray-500 mb-2 block">Share token:</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={token}
              readOnly
              className="flex-1 px-3 py-2 border-2 border-gray-200 rounded-lg font-mono bg-gray-50"
            />
            <Button
              variant="secondary"
              onClick={handleCopyToken}
              className="min-w-[80px]"
            >
              {copied ? 'Copied!' : 'Copy'}
            </Button>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            Share this token with others to let them join your list.
          </p>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-4">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
        </div>
      )}
    </Modal>
  )
}
