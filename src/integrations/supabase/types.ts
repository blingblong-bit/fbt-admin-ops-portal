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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      client_activities: {
        Row: {
          activity_type: string
          client_id: string
          created_at: string
          description: string
          id: string
          metadata: Json | null
        }
        Insert: {
          activity_type: string
          client_id: string
          created_at?: string
          description: string
          id?: string
          metadata?: Json | null
        }
        Update: {
          activity_type?: string
          client_id?: string
          created_at?: string
          description?: string
          id?: string
          metadata?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "client_activities_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          amount_paid: number
          created_at: string
          deleted_at: string | null
          email: string | null
          first_name: string
          id: string
          internal_notes: string | null
          is_scheduled: boolean
          last_name: string
          manual_active: boolean
          needs_review: boolean
          package_name: string | null
          package_price: number
          package_start_date: string | null
          package_total_visits: number
          phone: string | null
          square_customer_id: string | null
          square_visit_note: string | null
          status: string
          updated_at: string
          visits_used: number | null
        }
        Insert: {
          amount_paid?: number
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          first_name: string
          id?: string
          internal_notes?: string | null
          is_scheduled?: boolean
          last_name: string
          manual_active?: boolean
          needs_review?: boolean
          package_name?: string | null
          package_price?: number
          package_start_date?: string | null
          package_total_visits?: number
          phone?: string | null
          square_customer_id?: string | null
          square_visit_note?: string | null
          status?: string
          updated_at?: string
          visits_used?: number | null
        }
        Update: {
          amount_paid?: number
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          first_name?: string
          id?: string
          internal_notes?: string | null
          is_scheduled?: boolean
          last_name?: string
          manual_active?: boolean
          needs_review?: boolean
          package_name?: string | null
          package_price?: number
          package_start_date?: string | null
          package_total_visits?: number
          phone?: string | null
          square_customer_id?: string | null
          square_visit_note?: string | null
          status?: string
          updated_at?: string
          visits_used?: number | null
        }
        Relationships: []
      }
      duplicate_client_reviews: {
        Row: {
          archived_client_id: string | null
          client_a_id: string
          client_b_id: string
          created_at: string
          id: string
          kept_client_id: string | null
          reason: string | null
          resolved_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          archived_client_id?: string | null
          client_a_id: string
          client_b_id: string
          created_at?: string
          id?: string
          kept_client_id?: string | null
          reason?: string | null
          resolved_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          archived_client_id?: string | null
          client_a_id?: string
          client_b_id?: string
          created_at?: string
          id?: string
          kept_client_id?: string | null
          reason?: string | null
          resolved_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "duplicate_client_reviews_archived_client_id_fkey"
            columns: ["archived_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "duplicate_client_reviews_client_a_id_fkey"
            columns: ["client_a_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "duplicate_client_reviews_client_b_id_fkey"
            columns: ["client_b_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "duplicate_client_reviews_kept_client_id_fkey"
            columns: ["kept_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      imports: {
        Row: {
          created_at: string
          id: string
          parsed: boolean
          raw_text: string
        }
        Insert: {
          created_at?: string
          id?: string
          parsed?: boolean
          raw_text: string
        }
        Update: {
          created_at?: string
          id?: string
          parsed?: boolean
          raw_text?: string
        }
        Relationships: []
      }
      notes_ledger_resolutions: {
        Row: {
          created_at: string
          id: string
          internal_notes: string | null
          leading_amount: number | null
          line_number: number | null
          normalized_row_content: string | null
          package_price: number | null
          package_start_date: string | null
          package_total_visits: number | null
          parsed_name: string | null
          parsed_phone: string | null
          raw_row: string | null
          reason: string | null
          resolution_status: string
          resolved_at: string
          resolved_by: string | null
          resolved_client_id: string | null
          row_fingerprint: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          internal_notes?: string | null
          leading_amount?: number | null
          line_number?: number | null
          normalized_row_content?: string | null
          package_price?: number | null
          package_start_date?: string | null
          package_total_visits?: number | null
          parsed_name?: string | null
          parsed_phone?: string | null
          raw_row?: string | null
          reason?: string | null
          resolution_status: string
          resolved_at?: string
          resolved_by?: string | null
          resolved_client_id?: string | null
          row_fingerprint: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          internal_notes?: string | null
          leading_amount?: number | null
          line_number?: number | null
          normalized_row_content?: string | null
          package_price?: number | null
          package_start_date?: string | null
          package_total_visits?: number | null
          parsed_name?: string | null
          parsed_phone?: string | null
          raw_row?: string | null
          reason?: string | null
          resolution_status?: string
          resolved_at?: string
          resolved_by?: string | null
          resolved_client_id?: string | null
          row_fingerprint?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notes_ledger_resolutions_resolved_client_id_fkey"
            columns: ["resolved_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      square_customer_reviews: {
        Row: {
          created_at: string
          email: string | null
          family_name: string | null
          given_name: string | null
          id: string
          phone: string | null
          reason: string
          relevance: string
          square_customer_id: string
          status: string
          suggested_client_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          family_name?: string | null
          given_name?: string | null
          id?: string
          phone?: string | null
          reason: string
          relevance?: string
          square_customer_id: string
          status?: string
          suggested_client_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          family_name?: string | null
          given_name?: string | null
          id?: string
          phone?: string | null
          reason?: string
          relevance?: string
          square_customer_id?: string
          status?: string
          suggested_client_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "square_customer_reviews_suggested_client_id_fkey"
            columns: ["suggested_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      square_payments: {
        Row: {
          amount_cents: number
          applied: boolean
          buyer_email: string | null
          buyer_phone: string | null
          client_id: string | null
          created_at: string
          currency: string
          id: string
          needs_review: boolean
          note: string | null
          raw_event: Json | null
          square_customer_id: string | null
          square_payment_id: string
          status: string | null
          updated_at: string
        }
        Insert: {
          amount_cents?: number
          applied?: boolean
          buyer_email?: string | null
          buyer_phone?: string | null
          client_id?: string | null
          created_at?: string
          currency?: string
          id?: string
          needs_review?: boolean
          note?: string | null
          raw_event?: Json | null
          square_customer_id?: string | null
          square_payment_id: string
          status?: string | null
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          applied?: boolean
          buyer_email?: string | null
          buyer_phone?: string | null
          client_id?: string | null
          created_at?: string
          currency?: string
          id?: string
          needs_review?: boolean
          note?: string | null
          raw_event?: Json | null
          square_customer_id?: string | null
          square_payment_id?: string
          status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "square_payments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      square_sync_log: {
        Row: {
          action: string | null
          client_id: string | null
          created_at: string
          event_type: string
          id: string
          message: string | null
          raw_event: Json | null
          square_customer_id: string | null
          status: string
        }
        Insert: {
          action?: string | null
          client_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          message?: string | null
          raw_event?: Json | null
          square_customer_id?: string | null
          status: string
        }
        Update: {
          action?: string | null
          client_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          message?: string | null
          raw_event?: Json | null
          square_customer_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "square_sync_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_square_payment: {
        Args: {
          p_amount_cents: number
          p_client_id: string
          p_manual_resolution?: boolean
          p_match_method: string
          p_square_payment_id: string
        }
        Returns: {
          applied_amount: number
          newly_applied: boolean
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "superadmin" | "admin" | "moderator" | "user"
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
    Enums: {
      app_role: ["superadmin", "admin", "moderator", "user"],
    },
  },
} as const
