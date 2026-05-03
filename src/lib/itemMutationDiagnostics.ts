import { DIAGNOSTICS_DATA_COLLECTION_ENABLED } from '@/lib/diagnosticsFlags'
import { appendListDetailCacheDiagnostic } from '@/lib/offlineNavDiagnostics'

const DEBUG_ITEM_CREATE_REPLACE = process.env.NEXT_PUBLIC_DEBUG_ITEM_CREATE === '1'
const DEBUG_MEMBER_STATE = process.env.NEXT_PUBLIC_DEBUG_MEMBER_STATE === '1'

export function diagItemCreateReplace(msg: Record<string, unknown>) {
  if (!DEBUG_ITEM_CREATE_REPLACE || !DIAGNOSTICS_DATA_COLLECTION_ENABLED) return
  appendListDetailCacheDiagnostic(`[item-create-replace] ${JSON.stringify(msg)}`)
}

export function diagMemberStateMutation(msg: Record<string, unknown>) {
  if (!DEBUG_MEMBER_STATE || !DIAGNOSTICS_DATA_COLLECTION_ENABLED) return
  appendListDetailCacheDiagnostic(`[member-state-mutation] ${JSON.stringify(msg)}`)
}
