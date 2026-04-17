export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

/** public.items.category: 1–6 (UI maps each to a tint). Default is 1. */
export type ItemCategory = 1 | 2 | 3 | 4 | 5 | 6

export const ITEM_CATEGORIES: readonly ItemCategory[] = [1, 2, 3, 4, 5, 6]

export function normalizeItemCategory(value: unknown): ItemCategory {
  const n = typeof value === 'string' ? parseInt(value, 10) : Number(value)
  if (n === 1 || n === 2 || n === 3 || n === 4 || n === 5 || n === 6) return n
  return 1
}

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string | null
          nickname: string | null
          label_filter: string
          created_at: string
        }
        Insert: {
          id: string
          email?: string | null
          nickname?: string | null
          label_filter?: string
          created_at?: string
        }
        Update: {
          id?: string
          email?: string | null
          nickname?: string | null
          label_filter?: string
          created_at?: string
        }
      }
      lists: {
        Row: {
          id: string
          name: string
          owner_id: string
          visibility: 'private' | 'link'
          archived: boolean
          comment: string | null
          category_names: string | null
          category_order: string | null
          join_token: string | null
          join_role_granted: 'viewer' | 'editor'
          join_expires_at: string | null
          join_revoked_at: string | null
          join_use_count: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          owner_id: string
          visibility?: 'private' | 'link'
          archived?: boolean
          comment?: string | null
          category_names?: string | null
          category_order?: string | null
          join_token?: string | null
          join_role_granted?: 'viewer' | 'editor'
          join_expires_at?: string | null
          join_revoked_at?: string | null
          join_use_count?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          owner_id?: string
          visibility?: 'private' | 'link'
          archived?: boolean
          comment?: string | null
          category_names?: string | null
          category_order?: string | null
          join_token?: string | null
          join_role_granted?: 'viewer' | 'editor'
          join_expires_at?: string | null
          join_revoked_at?: string | null
          join_use_count?: number
          created_at?: string
          updated_at?: string
        }
      }
      list_users: {
        Row: {
          list_id: string
          user_id: string
          role: 'owner' | 'editor' | 'viewer'
          archived: boolean
          sort_order: number | null
          member_filter: string | null
          item_text_width: string | null
          show_targets: boolean
          label: string
          created_at: string
        }
        Insert: {
          list_id: string
          user_id: string
          role?: 'owner' | 'editor' | 'viewer'
          archived?: boolean
          sort_order?: number | null
          member_filter?: string | null
          item_text_width?: string | null
          show_targets?: boolean
          label?: string
          created_at?: string
        }
        Update: {
          list_id?: string
          user_id?: string
          role?: 'owner' | 'editor' | 'viewer'
          archived?: boolean
          sort_order?: number | null
          member_filter?: string | null
          item_text_width?: string | null
          show_targets?: boolean
          label?: string
          created_at?: string
        }
      }
      members: {
        Row: {
          id: string
          list_id: string
          name: string
          created_by: string | null
          sort_order: number | null
          is_public: boolean
          is_target: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          list_id: string
          name: string
          created_by?: string | null
          sort_order?: number | null
          is_public?: boolean
          is_target?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          list_id?: string
          name?: string
          created_by?: string | null
          sort_order?: number | null
          is_public?: boolean
          is_target?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      items: {
        Row: {
          id: string
          list_id: string
          text: string
          comment: string | null
          archived: boolean
          archived_at: string | null
          sort_order: number | null
          category: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          list_id: string
          text: string
          comment?: string | null
          archived?: boolean
          archived_at?: string | null
          sort_order?: number | null
          category?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          list_id?: string
          text?: string
          comment?: string | null
          archived?: boolean
          archived_at?: string | null
          sort_order?: number | null
          category?: number
          created_at?: string
          updated_at?: string
        }
      }
      item_member_state: {
        Row: {
          item_id: string
          member_id: string
          quantity: number
          done: boolean
          assigned: boolean
          updated_at: string
        }
        Insert: {
          item_id: string
          member_id: string
          quantity?: number
          done?: boolean
          assigned?: boolean
          updated_at?: string
        }
        Update: {
          item_id?: string
          member_id?: string
          quantity?: number
          done?: boolean
          assigned?: boolean
          updated_at?: string
        }
      }
    }
    Functions: {
      create_list: {
        Args: { p_name: string; p_label?: string }
        Returns: Database['public']['Tables']['lists']['Row']
      }
      join_list_by_token: {
        Args: { p_token: string }
        Returns: string
      }
      get_user_lists: {
        Args: Record<PropertyKey, never>
        Returns: {
          id: string
          name: string
          owner_id: string
          visibility: 'private' | 'link'
          archived: boolean
          created_at: string
          updated_at: string
          role: 'owner' | 'editor' | 'viewer'
          userArchived: boolean
          memberCount: number
          activeItemCount: number
          ownerNickname: string | null
          comment: string | null
          category_names: string | null
          category_order: string | null
          label: string
        }[]
      }
      get_list_data: {
        Args: { p_list_id: string }
        Returns: {
          list: Database['public']['Tables']['lists']['Row'] | null
          items: (Database['public']['Tables']['items']['Row'] & {
            memberStates: Record<string, Database['public']['Tables']['item_member_state']['Row']>
          })[]
          members: (Database['public']['Tables']['members']['Row'] & {
            creator?: { nickname: string | null } | null
          })[]
        }
      }
      duplicate_list: {
        Args: { p_source_list_id: string; p_new_name: string; p_label?: string }
        Returns: {
          list: Database['public']['Tables']['lists']['Row'] | null
          items: (Database['public']['Tables']['items']['Row'] & {
            memberStates: Record<string, Database['public']['Tables']['item_member_state']['Row']>
          })[]
          members: (Database['public']['Tables']['members']['Row'] & {
            creator?: { nickname: string | null } | null
          })[]
        }
      }
      change_quantity: {
        Args: { p_item_id: string; p_member_id: string; p_delta: number }
        Returns: number
      }
      update_member: {
        Args: { p_member_id: string; p_name: string | null; p_is_public: boolean | null }
        Returns: void
      }
      delete_member: {
        Args: { p_member_id: string }
        Returns: void
      }
      generate_share_token: {
        Args: { p_list_id: string; p_force_regenerate?: boolean }
        Returns: string
      }
      revoke_share_token: {
        Args: { p_list_id: string }
        Returns: void
      }
      get_list_joined_users: {
        Args: { p_list_id: string }
        Returns: {
          user_id: string
          nickname: string | null
          member_count: number
        }[]
      }
      remove_users_from_list: {
        Args: { p_list_id: string; p_user_ids: string[] }
        Returns: void
      }
      leave_list: {
        Args: { p_list_id: string }
        Returns: void
      }
      reorder_list_items: {
        Args: { p_list_id: string; p_item_ids: string[] }
        Returns: undefined
      }
      import_list: {
        Args: { p_name: string; p_label?: string; p_category_names?: string; p_rows?: Json; p_has_targets?: boolean }
        Returns: Database['public']['Tables']['lists']['Row']
      }
      own_member: {
        Args: { p_member_id: string }
        Returns: {
          member: Database['public']['Tables']['members']['Row'] & {
            creator?: { nickname: string | null } | null
          }
        }
      }
    }
  }
}

// Helper types
export type Profile = Database['public']['Tables']['profiles']['Row']
export type List = Database['public']['Tables']['lists']['Row']
export type ListUser = Database['public']['Tables']['list_users']['Row']
export type Member = Database['public']['Tables']['members']['Row']
export type Item = Database['public']['Tables']['items']['Row']
export type ItemMemberState = Database['public']['Tables']['item_member_state']['Row']

// Extended types with relations
export type MemberWithCreator = Member & {
  creator?: { nickname: string | null } | null
}

export type ListWithRole = List & {
  role: 'owner' | 'editor' | 'viewer'
  userArchived: boolean
  memberCount?: number
  activeItemCount?: number
  ownerNickname?: string | null
  comment?: string | null
  label?: string
}

export type ItemWithState = Database['public']['Functions']['get_list_data']['Returns']['items'][number]

/** Keys "1"-"6", values are user-defined category names (empty string = unnamed). */
export type CategoryNames = Record<string, string>
