'use client'

import Image, { type ImageProps } from 'next/image'
import { useTheme } from 'next-themes'

const DARK_VARIANTS: Record<string, string> = {
  '/logo.png': '/logo_dark_trans.png',
  '/profile.png': '/profile_dark_trans.png',
  '/share.png': '/share_dark_trans.png',
}

type ThemedImageProps = Omit<ImageProps, 'src'> & { src: string; alt: string }

export function ThemedImage({ src, className, ...props }: ThemedImageProps) {
  const { resolvedTheme } = useTheme()
  const darkSrc = DARK_VARIANTS[src]
  const finalSrc = resolvedTheme === 'dark' && darkSrc ? darkSrc : src

  return <Image {...props} src={finalSrc} className={className} />
}
