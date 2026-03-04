export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string | null
          username: string | null
          nickname: string | null
          created_at: string
        }
        Insert: {
          id: string
          email?: string | null
          username?: string | null
          nickname?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          email?: string | null
          username?: string | null
          nickname?: string | null
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
          join_token_hash: string | null
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
          join_token_hash?: string | null
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
          join_token_hash?: string | null
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
          created_at: string
        }
        Insert: {
          list_id: string
          user_id: string
          role?: 'owner' | 'editor' | 'viewer'
          archived?: boolean
          sort_order?: number | null
          created_at?: string
        }
        Update: {
          list_id?: string
          user_id?: string
          role?: 'owner' | 'editor' | 'viewer'
          archived?: boolean
          sort_order?: number | null
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
          updated_at: string
        }
        Insert: {
          item_id: string
          member_id: string
          quantity?: number
          done?: boolean
          updated_at?: string
        }
        Update: {
          item_id?: string
          member_id?: string
          quantity?: number
          done?: boolean
          updated_at?: string
        }
      }
    }
    Functions: {
      join_list_by_token: {
        Args: { p_token: string }
        Returns: string
      }
      change_quantity: {
        Args: { p_item_id: string; p_member_id: string; p_delta: number }
        Returns: number
      }
      generate_share_token: {
        Args: { p_list_id: string }
        Returns: string
      }
      revoke_share_token: {
        Args: { p_list_id: string }
        Returns: void
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
}

export type ItemWithState = Item & {
  memberStates: Record<string, ItemMemberState>
}
