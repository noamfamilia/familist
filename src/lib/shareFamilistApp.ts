import { canUseNativeShare, copyTextToClipboard, isMobileDevice } from '@/lib/clipboard'

export type ShareFamilistHandlers = {
  success: (message: string) => void
  error: (message: string) => void
}

export async function shareMyFamilistApp({ success, error: showError }: ShareFamilistHandlers) {
  const url = 'https://myfamilist.com/'

  const copyOnly = async () => {
    await copyTextToClipboard(url)
    if (!isMobileDevice()) {
      success('Copied to clipboard')
    }
  }

  if (!canUseNativeShare()) {
    await copyOnly()
    return
  }

  try {
    await navigator.share({
      title: 'MyFamiList',
      text: 'Shared list app for family and friends',
      url,
    })
  } catch (err) {
    const shareError = err as Error & { name?: string }
    if (shareError.name === 'AbortError') return
    console.error('Error sharing app link:', err)
    showError('Failed to share')
    await copyOnly()
  }
}
