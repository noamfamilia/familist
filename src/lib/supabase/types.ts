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

/** Keep in sync with `src/lib/data/base_sync_fields.ts` `SyncableFields`. */
export type DbSyncableFields = {
  client_created_at: string
  server_created_at: string | null
  deleted_at: string | null
  version: number
  last_synced_at: string | null
}

export type DbSyncableFieldsPartial = {
  client_created_at?: string
  server_created_at?: string | null
  deleted_at?: string | null
  version?: number
  last_synced_at?: string | null
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
          theme: 'light' | 'dark'
        } & DbSyncableFields
        Insert: {
          id: string
          email?: string | null
          nickname?: string | null
          label_filter?: string
          theme?: 'light' | 'dark'
        } & DbSyncableFieldsPartial
        Update: {
          id?: string
          email?: string | null
          nickname?: string | null
          label_filter?: string
          theme?: 'light' | 'dark'
        } & DbSyncableFieldsPartial
        Relationships: []
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
          updated_at: string
          last_content_update: string
        } & DbSyncableFields
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
          updated_at?: string
          last_content_update?: string
        } & DbSyncableFieldsPartial
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
          updated_at?: string
          last_content_update?: string
        } & DbSyncableFieldsPartial
        Relationships: []
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
          item_name_font_step: number
          show_targets: boolean
          last_viewed_members: string | null
          last_viewed: string | null
          sum_scope: 'none' | 'all' | 'active' | 'archived'
          label: string
        } & DbSyncableFields
        Insert: {
          list_id: string
          user_id: string
          role?: 'owner' | 'editor' | 'viewer'
          archived?: boolean
          sort_order?: number | null
          member_filter?: string | null
          item_text_width?: string | null
          item_name_font_step?: number
          show_targets?: boolean
          last_viewed_members?: string | null
          last_viewed?: string | null
          sum_scope?: 'none' | 'all' | 'active' | 'archived'
          label?: string
        } & DbSyncableFieldsPartial
        Update: {
          list_id?: string
          user_id?: string
          role?: 'owner' | 'editor' | 'viewer'
          archived?: boolean
          sort_order?: number | null
          member_filter?: string | null
          item_text_width?: string | null
          item_name_font_step?: number
          show_targets?: boolean
          last_viewed_members?: string | null
          last_viewed?: string | null
          sum_scope?: 'none' | 'all' | 'active' | 'archived'
          label?: string
        } & DbSyncableFieldsPartial
        Relationships: []
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
          updated_at: string
        } & DbSyncableFields
        Insert: {
          id?: string
          list_id: string
          name: string
          created_by?: string | null
          sort_order?: number | null
          is_public?: boolean
          is_target?: boolean
          updated_at?: string
        } & DbSyncableFieldsPartial
        Update: {
          id?: string
          list_id?: string
          name?: string
          created_by?: string | null
          sort_order?: number | null
          is_public?: boolean
          is_target?: boolean
          updated_at?: string
        } & DbSyncableFieldsPartial
        Relationships: []
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
          updated_at: string
        } & DbSyncableFields
        Insert: {
          id?: string
          list_id: string
          text: string
          comment?: string | null
          archived?: boolean
          archived_at?: string | null
          sort_order?: number | null
          category?: number
          updated_at?: string
        } & DbSyncableFieldsPartial
        Update: {
          id?: string
          list_id?: string
          text?: string
          comment?: string | null
          archived?: boolean
          archived_at?: string | null
          sort_order?: number | null
          category?: number
          updated_at?: string
        } & DbSyncableFieldsPartial
        Relationships: []
      }
      item_member_state: {
        Row: {
          item_id: string
          member_id: string
          quantity: number
          done: boolean
          assigned: boolean
          updated_at: string
        } & DbSyncableFields
        Insert: {
          item_id: string
          member_id: string
          quantity?: number
          done?: boolean
          assigned?: boolean
          updated_at?: string
        } & DbSyncableFieldsPartial
        Update: {
          item_id?: string
          member_id?: string
          quantity?: number
          done?: boolean
          assigned?: boolean
          updated_at?: string
        } & DbSyncableFieldsPartial
        Relationships: []
      }
      feedback: {
        Row: {
          id: string
          user_id: string
          email: string
          message: string
        } & DbSyncableFields
        Insert: {
          id?: string
          user_id: string
          email?: string
          message: string
        } & DbSyncableFieldsPartial
        Update: {
          id?: string
          user_id?: string
          email?: string
          message?: string
        } & DbSyncableFieldsPartial
        Relationships: []
      }
    }
    Views: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
    Functions: {
      create_list: {
        Args: {
          p_id?: string
          p_name: string
          p_label?: string
          p_client_created_at?: string
        }
        /** `{ list, display_name_changed, requested_name }` — `list` is the persisted row. */
        Returns: Json
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
          updated_at: string
          last_content_update: string
          client_created_at: string
          server_created_at: string | null
          deleted_at: string | null
          version: number
          last_synced_at: string | null
          role: 'owner' | 'editor' | 'viewer'
          userArchived: boolean
          sort_order: number | null
          last_viewed: string | null
          sumScope?: 'none' | 'all' | 'active' | 'archived'
          ownerNickname: string | null
          comment: string | null
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
      touch_list_viewed: {
        Args: { p_list_id: string }
        Returns: string
      }
      duplicate_list: {
        Args: {
          p_source_list_id: string
          p_new_name: string
          p_label?: string
          p_id?: string
          p_item_ids?: string[]
          p_target_member_id?: string
          p_client_created_at?: string
        }
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
      bulk_add_list_items: {
        Args: {
          p_list_id: string
          p_category: number
          p_lines: string[]
          p_item_ids?: string[]
        }
        /** `{ inserted_count, line_text_changes }` — `line_text_changes` is an array of `{ item_id, requested_text, text }`. */
        Returns: Json
      }
      upsert_item_sync: {
        Args: { p_item: Json }
        /** `{ item, display_name_changed, requested_text }` */
        Returns: Json
      }
      bulk_update_list_labels: {
        Args: { p_updates: Json }
        Returns: void
      }
      update_member: {
        Args: { p_member_id: string; p_name: string | null; p_is_public: boolean | null }
        /** `{ member, display_name_changed, requested_name }` */
        Returns: Json
      }
      apply_item_patch_sync: {
        Args: { p_item_id: string; p_patch: Json }
        /** `{ item, display_name_changed, requested_text }` */
        Returns: Json
      }
      apply_list_patch_sync: {
        Args: { p_list_id: string; p_patch: Json }
        /** `{ list, display_name_changed, requested_name }` */
        Returns: Json
      }
      upsert_member_sync: {
        Args: { p_member: Json }
        /** `{ member, display_name_changed, requested_name }` */
        Returns: Json
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
      delete_archived_items: {
        Args: { p_list_id: string }
        Returns: number
      }
      restore_archived_items: {
        Args: { p_list_id: string }
        Returns: number
      }
      reorder_user_lists: {
        Args: { p_list_ids: string[] }
        Returns: undefined
      }
      import_list: {
        Args: {
          p_id?: string
          p_name: string
          p_label?: string
          p_category_names?: string
          p_rows?: Json
          p_has_targets?: boolean
          p_item_ids?: string[]
          p_client_created_at?: string
        }
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
export type Feedback = Database['public']['Tables']['feedback']['Row']
export type ListUserSumScope = ListUser['sum_scope']
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
  sort_order?: number | null
  memberCount?: number
  activeItemCount?: number
  archivedItemCount?: number
  sumScope?: ListUserSumScope
  ownerNickname?: string | null
  comment?: string | null
  label?: string
  /** Per-user read cursor from `list_users.last_viewed`, used by the home activity LED. */
  last_viewed?: string | null
  /** Outbound sync queue rows touching this list (Dexie liveQuery). */
  pending_items?: number
  /** Dexie `list_users.sync_error`: last push failed until retry / success / manual edit */
  sync_error?: boolean
}

export type ItemWithState = Database['public']['Functions']['get_list_data']['Returns']['items'][number]

/** Keys "1"-"6", values are user-defined category names (empty string = unnamed). */
export type CategoryNames = Record<string, string>
