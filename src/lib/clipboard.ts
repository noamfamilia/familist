'use client'

const MOBILE_DEVICE_REGEX = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i

export function isMobileDevice() {
  if (typeof navigator === 'undefined') return false
  return MOBILE_DEVICE_REGEX.test(navigator.userAgent)
}

export function canUseNativeShare() {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    isMobileDevice()
  )
}

export async function copyTextToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const textArea = document.createElement('textarea')
    textArea.value = text
    document.body.appendChild(textArea)
    textArea.select()
    document.execCommand('copy')
    document.body.removeChild(textArea)
  }
}

export type ShareOrCopyTextHandlers = {
  /** Shown after a successful clipboard copy (desktop / share unavailable). */
  onCopied?: () => void
  onError?: (err: unknown) => void
}

/**
 * On mobile with Web Share API: open the native share sheet.
 * Otherwise copy to clipboard and call `onCopied`.
 * User cancel (AbortError) is silent.
 */
export async function shareOrCopyText(
  text: string,
  handlers: ShareOrCopyTextHandlers = {},
  shareFields?: { title?: string; url?: string },
) {
  const { onCopied, onError } = handlers

  if (canUseNativeShare()) {
    try {
      await navigator.share({
        ...(shareFields?.title ? { title: shareFields.title } : {}),
        text,
        ...(shareFields?.url ? { url: shareFields.url } : {}),
      })
      return
    } catch (err) {
      const shareError = err as Error & { name?: string }
      if (shareError.name === 'AbortError') return
      // Fall through to clipboard if share fails for another reason.
    }
  }

  try {
    await copyTextToClipboard(text)
    onCopied?.()
  } catch (err) {
    onError?.(err)
  }
}
