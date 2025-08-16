export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.4"
  }
  public: {
    Tables: {
      comments: {
        Row: {
          comment_id: string
          comment_text: string | null
          comment_url: string | null
          commenter_profile_id: string
          id: string
          is_edited: boolean | null
          is_pinned: boolean | null
          page_number: number | null
          post_id: string
          posted_at_date: string | null
          posted_at_timestamp: number | null
          reactions_breakdown: Json | null
          replies_count: number | null
          scraped_at: string | null
          total_reactions: number | null
          user_id: string
        }
        Insert: {
          comment_id: string
          comment_text?: string | null
          comment_url?: string | null
          commenter_profile_id: string
          id?: string
          is_edited?: boolean | null
          is_pinned?: boolean | null
          page_number?: number | null
          post_id: string
          posted_at_date?: string | null
          posted_at_timestamp?: number | null
          reactions_breakdown?: Json | null
          replies_count?: number | null
          scraped_at?: string | null
          total_reactions?: number | null
          user_id: string
        }
        Update: {
          comment_id?: string
          comment_text?: string | null
          comment_url?: string | null
          commenter_profile_id?: string
          id?: string
          is_edited?: boolean | null
          is_pinned?: boolean | null
          page_number?: number | null
          post_id?: string
          posted_at_date?: string | null
          posted_at_timestamp?: number | null
          reactions_breakdown?: Json | null
          replies_count?: number | null
          scraped_at?: string | null
          total_reactions?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_commenter_profile_id_fkey"
            columns: ["commenter_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          author_name: string | null
          author_profile_id: string | null
          author_profile_url: string | null
          created_at: string | null
          id: string
          last_comments_scrape: string | null
          last_reactions_scrape: string | null
          num_comments: number | null
          num_likes: number | null
          num_shares: number | null
          post_id: string | null
          post_text: string | null
          post_type: string | null
          post_url: string
          post_urn: string | null
          posted_at_iso: string | null
          posted_at_timestamp: number | null
          scraped_at: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          author_name?: string | null
          author_profile_id?: string | null
          author_profile_url?: string | null
          created_at?: string | null
          id?: string
          last_comments_scrape?: string | null
          last_reactions_scrape?: string | null
          num_comments?: number | null
          num_likes?: number | null
          num_shares?: number | null
          post_id?: string | null
          post_text?: string | null
          post_type?: string | null
          post_url: string
          post_urn?: string | null
          posted_at_iso?: string | null
          posted_at_timestamp?: number | null
          scraped_at?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          author_name?: string | null
          author_profile_id?: string | null
          author_profile_url?: string | null
          created_at?: string | null
          id?: string
          last_comments_scrape?: string | null
          last_reactions_scrape?: string | null
          num_comments?: number | null
          num_likes?: number | null
          num_shares?: number | null
          post_id?: string | null
          post_text?: string | null
          post_type?: string | null
          post_url?: string
          post_urn?: string | null
          posted_at_iso?: string | null
          posted_at_timestamp?: number | null
          scraped_at?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          first_seen: string | null
          headline: string | null
          id: string
          last_updated: string | null
          name: string | null
          profile_pictures: Json | null
          profile_url: string | null
          urn: string
        }
        Insert: {
          first_seen?: string | null
          headline?: string | null
          id?: string
          last_updated?: string | null
          name?: string | null
          profile_pictures?: Json | null
          profile_url?: string | null
          urn: string
        }
        Update: {
          first_seen?: string | null
          headline?: string | null
          id?: string
          last_updated?: string | null
          name?: string | null
          profile_pictures?: Json | null
          profile_url?: string | null
          urn?: string
        }
        Relationships: []
      }
      reactions: {
        Row: {
          id: string
          page_number: number | null
          post_id: string
          reaction_type: string
          reactor_profile_id: string
          scraped_at: string | null
          user_id: string
        }
        Insert: {
          id?: string
          page_number?: number | null
          post_id: string
          reaction_type: string
          reactor_profile_id: string
          scraped_at?: string | null
          user_id: string
        }
        Update: {
          id?: string
          page_number?: number | null
          post_id?: string
          reaction_type?: string
          reactor_profile_id?: string
          scraped_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reactions_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reactions_reactor_profile_id_fkey"
            columns: ["reactor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      scrape_jobs: {
        Row: {
          apify_run_id: string | null
          completed_at: string | null
          created_at: string | null
          error_message: string | null
          id: string
          job_type: string
          post_ids: string[] | null
          started_at: string | null
          status: string
          total_items_scraped: number | null
          user_id: string
        }
        Insert: {
          apify_run_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          job_type: string
          post_ids?: string[] | null
          started_at?: string | null
          status?: string
          total_items_scraped?: number | null
          user_id: string
        }
        Update: {
          apify_run_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          job_type?: string
          post_ids?: string[] | null
          started_at?: string | null
          status?: string
          total_items_scraped?: number | null
          user_id?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          apify_api_key: string
          created_at: string | null
          id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          apify_api_key: string
          created_at?: string | null
          id?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          apify_api_key?: string
          created_at?: string | null
          id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
