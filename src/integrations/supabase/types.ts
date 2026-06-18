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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      investor_snapshots: {
        Row: {
          collected_at: string
          investor_code: string
          market: string
          stock_code: string
          stock_name: string
          trade_date: string
          val_buy: number
          val_net: number
          val_sell: number
          vol_buy: number
          vol_net: number
          vol_sell: number
        }
        Insert: {
          collected_at?: string
          investor_code: string
          market: string
          stock_code: string
          stock_name?: string
          trade_date: string
          val_buy?: number
          val_net?: number
          val_sell?: number
          vol_buy?: number
          vol_net?: number
          vol_sell?: number
        }
        Update: {
          collected_at?: string
          investor_code?: string
          market?: string
          stock_code?: string
          stock_name?: string
          trade_date?: string
          val_buy?: number
          val_net?: number
          val_sell?: number
          vol_buy?: number
          vol_net?: number
          vol_sell?: number
        }
        Relationships: []
      }
      investor_sync_status: {
        Row: {
          last_attempt_at: string | null
          last_error: string | null
          last_success_at: string | null
          row_count: number
          sync_key: string
        }
        Insert: {
          last_attempt_at?: string | null
          last_error?: string | null
          last_success_at?: string | null
          row_count?: number
          sync_key: string
        }
        Update: {
          last_attempt_at?: string | null
          last_error?: string | null
          last_success_at?: string | null
          row_count?: number
          sync_key?: string
        }
        Relationships: []
      }
      investor_flow_daily: {
        Row: {
          close_price: number
          collected_at: string
          foreign_net: number
          individual_net: number
          institution_net: number
          market: string
          source: string
          stock_code: string
          stock_name: string
          trade_date: string
        }
        Insert: {
          close_price?: number
          collected_at?: string
          foreign_net?: number
          individual_net?: number
          institution_net?: number
          market?: string
          source?: string
          stock_code: string
          stock_name?: string
          trade_date: string
        }
        Update: {
          close_price?: number
          collected_at?: string
          foreign_net?: number
          individual_net?: number
          institution_net?: number
          market?: string
          source?: string
          stock_code?: string
          stock_name?: string
          trade_date?: string
        }
        Relationships: []
      }
      naver_theme_stocks: {
        Row: {
          rank_no: number
          scraped_at: string
          stock_code: string
          stock_name: string
          theme_no: number
          updated_at: string
        }
        Insert: {
          rank_no?: number
          scraped_at?: string
          stock_code: string
          stock_name: string
          theme_no: number
          updated_at?: string
        }
        Update: {
          rank_no?: number
          scraped_at?: string
          stock_code?: string
          stock_name?: string
          theme_no?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "naver_theme_stocks_theme_no_fkey"
            columns: ["theme_no"]
            isOneToOne: false
            referencedRelation: "naver_themes"
            referencedColumns: ["theme_no"]
          },
        ]
      }
      naver_theme_sync_status: {
        Row: {
          last_attempt_at: string | null
          last_error: string | null
          last_success_at: string | null
          source: string
          stock_count: number
          sync_key: string
          theme_count: number
        }
        Insert: {
          last_attempt_at?: string | null
          last_error?: string | null
          last_success_at?: string | null
          source?: string
          stock_count?: number
          sync_key: string
          theme_count?: number
        }
        Update: {
          last_attempt_at?: string | null
          last_error?: string | null
          last_success_at?: string | null
          source?: string
          stock_count?: number
          sync_key?: string
          theme_count?: number
        }
        Relationships: []
      }
      naver_themes: {
        Row: {
          detail_url: string
          page_no: number
          scraped_at: string
          stock_count: number
          theme_name: string
          theme_no: number
          updated_at: string
        }
        Insert: {
          detail_url: string
          page_no?: number
          scraped_at?: string
          stock_count?: number
          theme_name: string
          theme_no: number
          updated_at?: string
        }
        Update: {
          detail_url?: string
          page_no?: number
          scraped_at?: string
          stock_count?: number
          theme_name?: string
          theme_no?: number
          updated_at?: string
        }
        Relationships: []
      }
      screening_candidates: {
        Row: {
          change_rate: number
          close_price: number
          created_at: string
          market: string
          rank_no: number
          reason_summary: string | null
          run_key: string
          score: number
          signal: string
          stock_code: string
          stock_name: string
          tags: string | null
          volume: number
        }
        Insert: {
          change_rate?: number
          close_price?: number
          created_at?: string
          market?: string
          rank_no?: number
          reason_summary?: string | null
          run_key: string
          score?: number
          signal?: string
          stock_code: string
          stock_name?: string
          tags?: string | null
          volume?: number
        }
        Update: {
          change_rate?: number
          close_price?: number
          created_at?: string
          market?: string
          rank_no?: number
          reason_summary?: string | null
          run_key?: string
          score?: number
          signal?: string
          stock_code?: string
          stock_name?: string
          tags?: string | null
          volume?: number
        }
        Relationships: [
          {
            foreignKeyName: "screening_candidates_run_key_fkey"
            columns: ["run_key"]
            isOneToOne: false
            referencedRelation: "screening_runs"
            referencedColumns: ["run_key"]
          },
        ]
      }
      screening_runs: {
        Row: {
          as_of_date: string
          average_score: number
          candidate_count: number
          created_at: string
          max_score: number
          notes: string | null
          run_key: string
          run_label: string
          source: string
          status: string
          strategy_key: string
        }
        Insert: {
          as_of_date: string
          average_score?: number
          candidate_count?: number
          created_at?: string
          max_score?: number
          notes?: string | null
          run_key: string
          run_label?: string
          source?: string
          status?: string
          strategy_key?: string
        }
        Update: {
          as_of_date?: string
          average_score?: number
          candidate_count?: number
          created_at?: string
          max_score?: number
          notes?: string | null
          run_key?: string
          run_label?: string
          source?: string
          status?: string
          strategy_key?: string
        }
        Relationships: []
      }
      screening_sync_status: {
        Row: {
          last_attempt_at: string | null
          last_error: string | null
          last_success_at: string | null
          row_count: number
          run_count: number
          source: string
          sync_key: string
        }
        Insert: {
          last_attempt_at?: string | null
          last_error?: string | null
          last_success_at?: string | null
          row_count?: number
          run_count?: number
          source?: string
          sync_key: string
        }
        Update: {
          last_attempt_at?: string | null
          last_error?: string | null
          last_success_at?: string | null
          row_count?: number
          run_count?: number
          source?: string
          sync_key?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_investor_flow_ranked: {
        Args: {
          p_direction?: string
          p_end_date: string
          p_limit?: number
          p_market?: string
          p_sort_by?: string
          p_start_date: string
        }
        Returns: {
          days_count: number
          foreign_daily_net: number
          foreign_period_net: number
          individual_daily_net: number
          individual_period_net: number
          institution_daily_net: number
          institution_period_net: number
          latest_close_price: number
          latest_trade_date: string
          market: string
          sort_period_value: number
          stock_code: string
          stock_name: string
        }[]
      }
      get_investor_flow_leaders: {
        Args: {
          p_direction?: string
          p_end_date: string
          p_investor_type?: string
          p_limit?: number
          p_market?: string
          p_start_date: string
        }
        Returns: {
          average_net_value: number
          daily_net_value: number
          days_count: number
          latest_close_price: number
          latest_trade_date: string
          market: string
          period_net_value: number
          stock_code: string
          stock_name: string
        }[]
      }
      get_investor_flow_overview: {
        Args: Record<PropertyKey, never>
        Returns: {
          max_trade_date: string
          min_trade_date: string
          row_count: number
          stock_count: number
        }[]
      }
      get_investor_flow_trade_dates: {
        Args: {
          p_limit?: number
        }
        Returns: {
          trade_date: string
        }[]
      }
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
