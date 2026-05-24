import {
  formatSessionExpiredToast,
  type BootSessionVerifyCode,
} from '@/lib/sessionExpiredToast'

let bootSessionVerifyToastHandler: ((message: string) => void) | null = null

export function registerBootSessionVerifyToastHandler(fn: ((message: string) => void) | null): void {
  bootSessionVerifyToastHandler = fn
}

export function notifyBootSessionVerifyFailed(code: BootSessionVerifyCode): void {
  bootSessionVerifyToastHandler?.(formatSessionExpiredToast(code))
}
