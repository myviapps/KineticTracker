export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type AppRole = 'admin' | 'placement_officer' | 'faculty'

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      classrooms: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      daily_snapshots: {
        Row: {
          created_at: string
          easy_solved: number
          hard_solved: number
          medium_solved: number
          snapshot_date: string
          solved_that_day: number
          student_id: string
          total_solved: number
        }
        Insert: {
          created_at?: string
          easy_solved?: number
          hard_solved?: number
          medium_solved?: number
          snapshot_date: string
          solved_that_day?: number
          student_id: string
          total_solved?: number
        }
        Update: {
          created_at?: string
          easy_solved?: number
          hard_solved?: number
          medium_solved?: number
          snapshot_date?: string
          solved_that_day?: number
          student_id?: string
          total_solved?: number
        }
        Relationships: [
          {
            foreignKeyName: "daily_snapshots_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      recent_submissions: {
        Row: {
          id: string
          lang: string | null
          student_id: string
          submitted_at: string
          title: string
          title_slug: string
        }
        Insert: {
          id?: string
          lang?: string | null
          student_id: string
          submitted_at: string
          title: string
          title_slug: string
        }
        Update: {
          id?: string
          lang?: string | null
          student_id?: string
          submitted_at?: string
          title?: string
          title_slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "recent_submissions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      student_stats: {
        Row: {
          acceptance_rate: number | null
          avatar: string | null
          badges: Json | null
          contest_global_ranking: number | null
          contest_rating: number | null
          contest_top_percentage: number | null
          contests_attended: number | null
          country: string | null
          easy_solved: number | null
          easy_total: number | null
          hard_solved: number | null
          hard_total: number | null
          language_stats: Json | null
          medium_solved: number | null
          medium_total: number | null
          ranking: number | null
          real_name: string | null
          reputation: number | null
          streak: number | null
          student_id: string
          submission_calendar: Json | null
          tag_stats: Json | null
          total_active_days: number | null
          total_questions: number | null
          total_solved: number | null
          updated_at: string
        }
        Insert: {
          acceptance_rate?: number | null
          avatar?: string | null
          badges?: Json | null
          contest_global_ranking?: number | null
          contest_rating?: number | null
          contest_top_percentage?: number | null
          contests_attended?: number | null
          country?: string | null
          easy_solved?: number | null
          easy_total?: number | null
          hard_solved?: number | null
          hard_total?: number | null
          language_stats?: Json | null
          medium_solved?: number | null
          medium_total?: number | null
          ranking?: number | null
          real_name?: string | null
          reputation?: number | null
          streak?: number | null
          student_id: string
          submission_calendar?: Json | null
          tag_stats?: Json | null
          total_active_days?: number | null
          total_questions?: number | null
          total_solved?: number | null
          updated_at?: string
        }
        Update: {
          acceptance_rate?: number | null
          avatar?: string | null
          badges?: Json | null
          contest_global_ranking?: number | null
          contest_rating?: number | null
          contest_top_percentage?: number | null
          contests_attended?: number | null
          country?: string | null
          easy_solved?: number | null
          easy_total?: number | null
          hard_solved?: number | null
          hard_total?: number | null
          language_stats?: Json | null
          medium_solved?: number | null
          medium_total?: number | null
          ranking?: number | null
          real_name?: string | null
          reputation?: number | null
          streak?: number | null
          student_id?: string
          submission_calendar?: Json | null
          tag_stats?: Json | null
          total_active_days?: number | null
          total_questions?: number | null
          total_solved?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_stats_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: true
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      students: {
        Row: {
          classroom_id: string
          created_at: string
          email: string | null
          id: string
          last_scraped_at: string | null
          leetcode_id: string
          name: string
          roll: string
          scrape_error: string | null
        }
        Insert: {
          classroom_id: string
          created_at?: string
          email?: string | null
          id?: string
          last_scraped_at?: string | null
          leetcode_id: string
          name: string
          roll: string
          scrape_error?: string | null
        }
        Update: {
          classroom_id?: string
          created_at?: string
          email?: string | null
          id?: string
          last_scraped_at?: string | null
          leetcode_id?: string
          name?: string
          roll?: string
          scrape_error?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "students_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          user_id: string
          role: AppRole
        }
        Insert: {
          id?: string
          user_id: string
          role: AppRole
        }
        Update: {
          id?: string
          user_id?: string
          role?: AppRole
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      faculty_assignments: {
        Row: {
          faculty_user_id: string
          classroom_id: string
          assigned_at: string
        }
        Insert: {
          faculty_user_id: string
          classroom_id: string
          assigned_at?: string
        }
        Update: {
          faculty_user_id?: string
          classroom_id?: string
          assigned_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "faculty_assignments_faculty_user_id_fkey"
            columns: ["faculty_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "faculty_assignments_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
        ]
      }
      refresh_locks: {
        Row: {
          lock_key: string
          classroom_id: string
          started_by: string
          started_at: string
          expires_at: string
        }
        Insert: {
          lock_key: string
          classroom_id: string
          started_by: string
          started_at?: string
          expires_at: string
        }
        Update: {
          lock_key?: string
          classroom_id?: string
          started_by?: string
          started_at?: string
          expires_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "refresh_locks_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
        ]
      }
      site_settings: {
        Row: {
          id: number
          google_auth_enabled: boolean
        }
        Insert: {
          id?: number
          google_auth_enabled?: boolean
        }
        Update: {
          id?: number
          google_auth_enabled?: boolean
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
      app_role: AppRole
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
    Enums: { app_role: ['admin', 'placement_officer', 'faculty'] },
  },
} as const
