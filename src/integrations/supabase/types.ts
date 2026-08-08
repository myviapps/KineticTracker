export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      classroom_students: {
        Row: {
          added_at: string;
          classroom_id: string;
          student_id: string;
        };
        Insert: {
          added_at?: string;
          classroom_id: string;
          student_id: string;
        };
        Update: {
          added_at?: string;
          classroom_id?: string;
          student_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "classroom_students_classroom_id_fkey";
            columns: ["classroom_id"];
            isOneToOne: false;
            referencedRelation: "classrooms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "classroom_students_classroom_id_fkey";
            columns: ["classroom_id"];
            isOneToOne: false;
            referencedRelation: "classrooms_public";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "classroom_students_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "student_scores";
            referencedColumns: ["student_id"];
          },
          {
            foreignKeyName: "classroom_students_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "classroom_students_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students_public";
            referencedColumns: ["id"];
          },
        ];
      };
      classrooms: {
        Row: {
          college_id: string;
          created_at: string;
          description: string | null;
          id: string;
          name: string;
        };
        Insert: {
          college_id: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          name: string;
        };
        Update: {
          college_id?: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          name?: string;
        };
        Relationships: [
          {
            foreignKeyName: "classrooms_college_id_fkey";
            columns: ["college_id"];
            isOneToOne: false;
            referencedRelation: "college_overview";
            referencedColumns: ["college_id"];
          },
          {
            foreignKeyName: "classrooms_college_id_fkey";
            columns: ["college_id"];
            isOneToOne: false;
            referencedRelation: "colleges";
            referencedColumns: ["id"];
          },
        ];
      };
      college_assignments: {
        Row: {
          assigned_at: string;
          college_id: string;
          user_id: string;
        };
        Insert: {
          assigned_at?: string;
          college_id: string;
          user_id: string;
        };
        Update: {
          assigned_at?: string;
          college_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "college_assignments_college_id_fkey";
            columns: ["college_id"];
            isOneToOne: false;
            referencedRelation: "college_overview";
            referencedColumns: ["college_id"];
          },
          {
            foreignKeyName: "college_assignments_college_id_fkey";
            columns: ["college_id"];
            isOneToOne: false;
            referencedRelation: "colleges";
            referencedColumns: ["id"];
          },
        ];
      };
      colleges: {
        Row: {
          city: string | null;
          created_at: string;
          id: string;
          name: string;
          slug: string;
        };
        Insert: {
          city?: string | null;
          created_at?: string;
          id?: string;
          name: string;
          slug: string;
        };
        Update: {
          city?: string | null;
          created_at?: string;
          id?: string;
          name?: string;
          slug?: string;
        };
        Relationships: [];
      };
      daily_snapshots: {
        Row: {
          created_at: string;
          easy_solved: number;
          hard_solved: number;
          medium_solved: number;
          platform_id: string;
          platform_score: number | null;
          rating: number | null;
          snapshot_date: string;
          solved_that_day: number;
          student_id: string;
          total_solved: number;
          unrated_solved: number | null;
        };
        Insert: {
          created_at?: string;
          easy_solved?: number;
          hard_solved?: number;
          medium_solved?: number;
          platform_id?: string;
          platform_score?: number | null;
          rating?: number | null;
          snapshot_date: string;
          solved_that_day?: number;
          student_id: string;
          total_solved?: number;
          unrated_solved?: number | null;
        };
        Update: {
          created_at?: string;
          easy_solved?: number;
          hard_solved?: number;
          medium_solved?: number;
          platform_id?: string;
          platform_score?: number | null;
          rating?: number | null;
          snapshot_date?: string;
          solved_that_day?: number;
          student_id?: string;
          total_solved?: number;
          unrated_solved?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "daily_snapshots_platform_id_fkey";
            columns: ["platform_id"];
            isOneToOne: false;
            referencedRelation: "platforms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "daily_snapshots_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "student_scores";
            referencedColumns: ["student_id"];
          },
          {
            foreignKeyName: "daily_snapshots_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "daily_snapshots_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students_public";
            referencedColumns: ["id"];
          },
        ];
      };
      faculty_assignments: {
        Row: {
          assigned_at: string;
          classroom_id: string;
          faculty_user_id: string;
        };
        Insert: {
          assigned_at?: string;
          classroom_id: string;
          faculty_user_id: string;
        };
        Update: {
          assigned_at?: string;
          classroom_id?: string;
          faculty_user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "faculty_assignments_classroom_id_fkey";
            columns: ["classroom_id"];
            isOneToOne: false;
            referencedRelation: "classrooms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "faculty_assignments_classroom_id_fkey";
            columns: ["classroom_id"];
            isOneToOne: false;
            referencedRelation: "classrooms_public";
            referencedColumns: ["id"];
          },
        ];
      };
      platform_stats: {
        Row: {
          account_id: string;
          avatar: string | null;
          contests_attended: number | null;
          country: string | null;
          country_rank: number | null;
          data: Json;
          display_name: string | null;
          easy_solved: number | null;
          error_msg: string | null;
          fetch_status: string;
          fetched_at: string;
          global_rank: number | null;
          hard_solved: number | null;
          institute_rank: number | null;
          max_rating: number | null;
          medium_solved: number | null;
          platform_id: string;
          platform_score: number | null;
          rating: number | null;
          stars: number | null;
          streak: number | null;
          student_id: string;
          total_solved: number | null;
          unrated_solved: number | null;
        };
        Insert: {
          account_id: string;
          avatar?: string | null;
          contests_attended?: number | null;
          country?: string | null;
          country_rank?: number | null;
          data?: Json;
          display_name?: string | null;
          easy_solved?: number | null;
          error_msg?: string | null;
          fetch_status?: string;
          fetched_at?: string;
          global_rank?: number | null;
          hard_solved?: number | null;
          institute_rank?: number | null;
          max_rating?: number | null;
          medium_solved?: number | null;
          platform_id: string;
          platform_score?: number | null;
          rating?: number | null;
          stars?: number | null;
          streak?: number | null;
          student_id: string;
          total_solved?: number | null;
          unrated_solved?: number | null;
        };
        Update: {
          account_id?: string;
          avatar?: string | null;
          contests_attended?: number | null;
          country?: string | null;
          country_rank?: number | null;
          data?: Json;
          display_name?: string | null;
          easy_solved?: number | null;
          error_msg?: string | null;
          fetch_status?: string;
          fetched_at?: string;
          global_rank?: number | null;
          hard_solved?: number | null;
          institute_rank?: number | null;
          max_rating?: number | null;
          medium_solved?: number | null;
          platform_id?: string;
          platform_score?: number | null;
          rating?: number | null;
          stars?: number | null;
          streak?: number | null;
          student_id?: string;
          total_solved?: number | null;
          unrated_solved?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "platform_stats_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: true;
            referencedRelation: "student_platform_accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "platform_stats_platform_id_fkey";
            columns: ["platform_id"];
            isOneToOne: false;
            referencedRelation: "platforms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "platform_stats_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "student_scores";
            referencedColumns: ["student_id"];
          },
          {
            foreignKeyName: "platform_stats_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "platform_stats_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students_public";
            referencedColumns: ["id"];
          },
        ];
      };
      platforms: {
        Row: {
          adapter_version: number;
          base_cooldown_ms: number;
          batch_size: number;
          created_at: string;
          enabled: boolean;
          est_batch_ms: number;
          id: string;
          max_concurrency: number;
          name: string;
          notes: string | null;
          profile_url_template: string;
          rank_metric: string;
          rating_baseline: number | null;
          rating_weight: number;
          refresh_ttl_hours: number;
          sort_order: number;
          supports_batch_fetch: boolean;
          tier: string;
          weight_easy: number;
          weight_hard: number;
          weight_medium: number;
          weight_unrated: number;
        };
        Insert: {
          adapter_version?: number;
          base_cooldown_ms?: number;
          batch_size?: number;
          created_at?: string;
          enabled?: boolean;
          est_batch_ms?: number;
          id: string;
          max_concurrency?: number;
          name: string;
          notes?: string | null;
          profile_url_template: string;
          rank_metric?: string;
          rating_baseline?: number | null;
          rating_weight?: number;
          refresh_ttl_hours?: number;
          sort_order?: number;
          supports_batch_fetch?: boolean;
          tier: string;
          weight_easy?: number;
          weight_hard?: number;
          weight_medium?: number;
          weight_unrated?: number;
        };
        Update: {
          adapter_version?: number;
          base_cooldown_ms?: number;
          batch_size?: number;
          created_at?: string;
          enabled?: boolean;
          est_batch_ms?: number;
          id?: string;
          max_concurrency?: number;
          name?: string;
          notes?: string | null;
          profile_url_template?: string;
          rank_metric?: string;
          rating_baseline?: number | null;
          rating_weight?: number;
          refresh_ttl_hours?: number;
          sort_order?: number;
          supports_batch_fetch?: boolean;
          tier?: string;
          weight_easy?: number;
          weight_hard?: number;
          weight_medium?: number;
          weight_unrated?: number;
        };
        Relationships: [];
      };
      recent_submissions: {
        Row: {
          id: string;
          lang: string | null;
          platform_id: string;
          student_id: string;
          submitted_at: string;
          title: string;
          title_slug: string;
        };
        Insert: {
          id?: string;
          lang?: string | null;
          platform_id?: string;
          student_id: string;
          submitted_at: string;
          title: string;
          title_slug: string;
        };
        Update: {
          id?: string;
          lang?: string | null;
          platform_id?: string;
          student_id?: string;
          submitted_at?: string;
          title?: string;
          title_slug?: string;
        };
        Relationships: [
          {
            foreignKeyName: "recent_submissions_platform_id_fkey";
            columns: ["platform_id"];
            isOneToOne: false;
            referencedRelation: "platforms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recent_submissions_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "student_scores";
            referencedColumns: ["student_id"];
          },
          {
            foreignKeyName: "recent_submissions_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recent_submissions_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students_public";
            referencedColumns: ["id"];
          },
        ];
      };
      refresh_jobs: {
        Row: {
          batch_size: number;
          classroom_id: string | null;
          clean_streak: number;
          cooldown_ms: number;
          created_at: string;
          created_by: string | null;
          cursor_account_id: string | null;
          cursor_student_id: string | null;
          errors: Json;
          est_batch_ms: number;
          failed: number;
          filter: string;
          finished_at: string | null;
          id: string;
          last_error: string | null;
          lease_owner: string | null;
          lease_until: string | null;
          lock_key: string;
          platform_id: string | null;
          processed: number;
          resume_after: string | null;
          scope: string;
          stale_before: string | null;
          started_at: string | null;
          status: string;
          student_ids: string[] | null;
          succeeded: number;
          total: number;
        };
        Insert: {
          batch_size?: number;
          classroom_id?: string | null;
          clean_streak?: number;
          cooldown_ms?: number;
          created_at?: string;
          created_by?: string | null;
          cursor_account_id?: string | null;
          cursor_student_id?: string | null;
          errors?: Json;
          est_batch_ms?: number;
          failed?: number;
          filter?: string;
          finished_at?: string | null;
          id?: string;
          last_error?: string | null;
          lease_owner?: string | null;
          lease_until?: string | null;
          lock_key?: string;
          platform_id?: string | null;
          processed?: number;
          resume_after?: string | null;
          scope: string;
          stale_before?: string | null;
          started_at?: string | null;
          status?: string;
          student_ids?: string[] | null;
          succeeded?: number;
          total?: number;
        };
        Update: {
          batch_size?: number;
          classroom_id?: string | null;
          clean_streak?: number;
          cooldown_ms?: number;
          created_at?: string;
          created_by?: string | null;
          cursor_account_id?: string | null;
          cursor_student_id?: string | null;
          errors?: Json;
          est_batch_ms?: number;
          failed?: number;
          filter?: string;
          finished_at?: string | null;
          id?: string;
          last_error?: string | null;
          lease_owner?: string | null;
          lease_until?: string | null;
          lock_key?: string;
          platform_id?: string | null;
          processed?: number;
          resume_after?: string | null;
          scope?: string;
          stale_before?: string | null;
          started_at?: string | null;
          status?: string;
          student_ids?: string[] | null;
          succeeded?: number;
          total?: number;
        };
        Relationships: [
          {
            foreignKeyName: "refresh_jobs_classroom_id_fkey";
            columns: ["classroom_id"];
            isOneToOne: false;
            referencedRelation: "classrooms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "refresh_jobs_classroom_id_fkey";
            columns: ["classroom_id"];
            isOneToOne: false;
            referencedRelation: "classrooms_public";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "refresh_jobs_cursor_account_id_fkey";
            columns: ["cursor_account_id"];
            isOneToOne: false;
            referencedRelation: "student_platform_accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "refresh_jobs_platform_id_fkey";
            columns: ["platform_id"];
            isOneToOne: false;
            referencedRelation: "platforms";
            referencedColumns: ["id"];
          },
        ];
      };
      refresh_locks: {
        Row: {
          classroom_id: string;
          expires_at: string;
          lock_key: string;
          started_at: string;
          started_by: string;
        };
        Insert: {
          classroom_id: string;
          expires_at: string;
          lock_key: string;
          started_at?: string;
          started_by: string;
        };
        Update: {
          classroom_id?: string;
          expires_at?: string;
          lock_key?: string;
          started_at?: string;
          started_by?: string;
        };
        Relationships: [
          {
            foreignKeyName: "refresh_locks_classroom_id_fkey";
            columns: ["classroom_id"];
            isOneToOne: false;
            referencedRelation: "classrooms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "refresh_locks_classroom_id_fkey";
            columns: ["classroom_id"];
            isOneToOne: false;
            referencedRelation: "classrooms_public";
            referencedColumns: ["id"];
          },
        ];
      };
      scrape_runs: {
        Row: {
          classroom_id: string | null;
          completed_at: string | null;
          errors: Json | null;
          failed_count: number;
          id: string;
          platform_id: string | null;
          source: string;
          started_at: string;
          student_id: string | null;
          success_count: number;
          total_students: number;
        };
        Insert: {
          classroom_id?: string | null;
          completed_at?: string | null;
          errors?: Json | null;
          failed_count?: number;
          id?: string;
          platform_id?: string | null;
          source: string;
          started_at?: string;
          student_id?: string | null;
          success_count?: number;
          total_students?: number;
        };
        Update: {
          classroom_id?: string | null;
          completed_at?: string | null;
          errors?: Json | null;
          failed_count?: number;
          id?: string;
          platform_id?: string | null;
          source?: string;
          started_at?: string;
          student_id?: string | null;
          success_count?: number;
          total_students?: number;
        };
        Relationships: [
          {
            foreignKeyName: "scrape_runs_classroom_id_fkey";
            columns: ["classroom_id"];
            isOneToOne: false;
            referencedRelation: "classrooms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scrape_runs_classroom_id_fkey";
            columns: ["classroom_id"];
            isOneToOne: false;
            referencedRelation: "classrooms_public";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scrape_runs_platform_id_fkey";
            columns: ["platform_id"];
            isOneToOne: false;
            referencedRelation: "platforms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scrape_runs_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "student_scores";
            referencedColumns: ["student_id"];
          },
          {
            foreignKeyName: "scrape_runs_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scrape_runs_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students_public";
            referencedColumns: ["id"];
          },
        ];
      };
      site_settings: {
        Row: {
          created_at: string;
          google_auth_enabled: boolean;
          id: number;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          google_auth_enabled?: boolean;
          id: number;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          google_auth_enabled?: boolean;
          id?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      student_platform_accounts: {
        Row: {
          consecutive_failures: number;
          created_at: string;
          fetch_error: string | null;
          handle: string;
          handle_normalized: string | null;
          id: string;
          last_fetched_at: string | null;
          platform_id: string;
          status: string;
          student_id: string;
          sync_cursor: Json;
          verified_at: string | null;
        };
        Insert: {
          consecutive_failures?: number;
          created_at?: string;
          fetch_error?: string | null;
          handle: string;
          handle_normalized?: string | null;
          id?: string;
          last_fetched_at?: string | null;
          platform_id: string;
          status?: string;
          student_id: string;
          sync_cursor?: Json;
          verified_at?: string | null;
        };
        Update: {
          consecutive_failures?: number;
          created_at?: string;
          fetch_error?: string | null;
          handle?: string;
          handle_normalized?: string | null;
          id?: string;
          last_fetched_at?: string | null;
          platform_id?: string;
          status?: string;
          student_id?: string;
          sync_cursor?: Json;
          verified_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "student_platform_accounts_platform_id_fkey";
            columns: ["platform_id"];
            isOneToOne: false;
            referencedRelation: "platforms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "student_platform_accounts_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "student_scores";
            referencedColumns: ["student_id"];
          },
          {
            foreignKeyName: "student_platform_accounts_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "student_platform_accounts_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students_public";
            referencedColumns: ["id"];
          },
        ];
      };
      student_stats: {
        Row: {
          acceptance_rate: number | null;
          avatar: string | null;
          badges: Json | null;
          contest_global_ranking: number | null;
          contest_rating: number | null;
          contest_top_percentage: number | null;
          contests_attended: number | null;
          country: string | null;
          easy_solved: number | null;
          easy_total: number | null;
          hard_solved: number | null;
          hard_total: number | null;
          language_stats: Json | null;
          medium_solved: number | null;
          medium_total: number | null;
          ranking: number | null;
          real_name: string | null;
          reputation: number | null;
          streak: number | null;
          student_id: string;
          submission_calendar: Json | null;
          tag_stats: Json | null;
          total_active_days: number | null;
          total_questions: number | null;
          total_solved: number | null;
          updated_at: string;
        };
        Insert: {
          acceptance_rate?: number | null;
          avatar?: string | null;
          badges?: Json | null;
          contest_global_ranking?: number | null;
          contest_rating?: number | null;
          contest_top_percentage?: number | null;
          contests_attended?: number | null;
          country?: string | null;
          easy_solved?: number | null;
          easy_total?: number | null;
          hard_solved?: number | null;
          hard_total?: number | null;
          language_stats?: Json | null;
          medium_solved?: number | null;
          medium_total?: number | null;
          ranking?: number | null;
          real_name?: string | null;
          reputation?: number | null;
          streak?: number | null;
          student_id: string;
          submission_calendar?: Json | null;
          tag_stats?: Json | null;
          total_active_days?: number | null;
          total_questions?: number | null;
          total_solved?: number | null;
          updated_at?: string;
        };
        Update: {
          acceptance_rate?: number | null;
          avatar?: string | null;
          badges?: Json | null;
          contest_global_ranking?: number | null;
          contest_rating?: number | null;
          contest_top_percentage?: number | null;
          contests_attended?: number | null;
          country?: string | null;
          easy_solved?: number | null;
          easy_total?: number | null;
          hard_solved?: number | null;
          hard_total?: number | null;
          language_stats?: Json | null;
          medium_solved?: number | null;
          medium_total?: number | null;
          ranking?: number | null;
          real_name?: string | null;
          reputation?: number | null;
          streak?: number | null;
          student_id?: string;
          submission_calendar?: Json | null;
          tag_stats?: Json | null;
          total_active_days?: number | null;
          total_questions?: number | null;
          total_solved?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "student_stats_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: true;
            referencedRelation: "student_scores";
            referencedColumns: ["student_id"];
          },
          {
            foreignKeyName: "student_stats_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: true;
            referencedRelation: "students";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "student_stats_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: true;
            referencedRelation: "students_public";
            referencedColumns: ["id"];
          },
        ];
      };
      students: {
        Row: {
          classroom_id_legacy: string | null;
          consecutive_failures: number;
          created_at: string;
          email: string | null;
          id: string;
          last_scraped_at: string | null;
          leetcode_id: string;
          name: string;
          roll: string;
          scrape_error: string | null;
        };
        Insert: {
          classroom_id_legacy?: string | null;
          consecutive_failures?: number;
          created_at?: string;
          email?: string | null;
          id?: string;
          last_scraped_at?: string | null;
          leetcode_id: string;
          name: string;
          roll: string;
          scrape_error?: string | null;
        };
        Update: {
          classroom_id_legacy?: string | null;
          consecutive_failures?: number;
          created_at?: string;
          email?: string | null;
          id?: string;
          last_scraped_at?: string | null;
          leetcode_id?: string;
          name?: string;
          roll?: string;
          scrape_error?: string | null;
        };
        Relationships: [];
      };
      user_roles: {
        Row: {
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      classrooms_public: {
        Row: {
          created_at: string | null;
          description: string | null;
          id: string | null;
          name: string | null;
        };
        Insert: {
          created_at?: string | null;
          description?: string | null;
          id?: string | null;
          name?: string | null;
        };
        Update: {
          created_at?: string | null;
          description?: string | null;
          id?: string | null;
          name?: string | null;
        };
        Relationships: [];
      };
      college_overview: {
        Row: {
          avg_score: number | null;
          classroom_count: number | null;
          college_id: string | null;
          college_name: string | null;
          college_slug: string | null;
          platforms_in_use: number | null;
          student_count: number | null;
          total_score: number | null;
          total_solved: number | null;
        };
        Relationships: [];
      };
      daily_snapshots_public: {
        Row: {
          created_at: string | null;
          easy_solved: number | null;
          hard_solved: number | null;
          medium_solved: number | null;
          snapshot_date: string | null;
          solved_that_day: number | null;
          student_id: string | null;
          total_solved: number | null;
        };
        Insert: {
          created_at?: string | null;
          easy_solved?: number | null;
          hard_solved?: number | null;
          medium_solved?: number | null;
          snapshot_date?: string | null;
          solved_that_day?: number | null;
          student_id?: string | null;
          total_solved?: number | null;
        };
        Update: {
          created_at?: string | null;
          easy_solved?: number | null;
          hard_solved?: number | null;
          medium_solved?: number | null;
          snapshot_date?: string | null;
          solved_that_day?: number | null;
          student_id?: string | null;
          total_solved?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "daily_snapshots_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "student_scores";
            referencedColumns: ["student_id"];
          },
          {
            foreignKeyName: "daily_snapshots_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "daily_snapshots_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students_public";
            referencedColumns: ["id"];
          },
        ];
      };
      recent_submissions_public: {
        Row: {
          id: string | null;
          lang: string | null;
          student_id: string | null;
          submitted_at: string | null;
          title: string | null;
          title_slug: string | null;
        };
        Insert: {
          id?: string | null;
          lang?: string | null;
          student_id?: string | null;
          submitted_at?: string | null;
          title?: string | null;
          title_slug?: string | null;
        };
        Update: {
          id?: string | null;
          lang?: string | null;
          student_id?: string | null;
          submitted_at?: string | null;
          title?: string | null;
          title_slug?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "recent_submissions_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "student_scores";
            referencedColumns: ["student_id"];
          },
          {
            foreignKeyName: "recent_submissions_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recent_submissions_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students_public";
            referencedColumns: ["id"];
          },
        ];
      };
      student_colleges: {
        Row: {
          college_id: string | null;
          college_name: string | null;
          college_slug: string | null;
          student_id: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "classroom_students_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "student_scores";
            referencedColumns: ["student_id"];
          },
          {
            foreignKeyName: "classroom_students_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "classroom_students_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students_public";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "classrooms_college_id_fkey";
            columns: ["college_id"];
            isOneToOne: false;
            referencedRelation: "college_overview";
            referencedColumns: ["college_id"];
          },
          {
            foreignKeyName: "classrooms_college_id_fkey";
            columns: ["college_id"];
            isOneToOne: false;
            referencedRelation: "colleges";
            referencedColumns: ["id"];
          },
        ];
      };
      student_scores: {
        Row: {
          almanac_score: number | null;
          platform_count: number | null;
          score_breakdown: Json | null;
          student_id: string | null;
        };
        Relationships: [];
      };
      student_stats_public: {
        Row: {
          acceptance_rate: number | null;
          avatar: string | null;
          badges: Json | null;
          contest_global_ranking: number | null;
          contest_rating: number | null;
          contest_top_percentage: number | null;
          contests_attended: number | null;
          country: string | null;
          easy_solved: number | null;
          easy_total: number | null;
          hard_solved: number | null;
          hard_total: number | null;
          language_stats: Json | null;
          medium_solved: number | null;
          medium_total: number | null;
          ranking: number | null;
          real_name: string | null;
          streak: number | null;
          student_id: string | null;
          submission_calendar: Json | null;
          tag_stats: Json | null;
          total_active_days: number | null;
          total_questions: number | null;
          total_solved: number | null;
          updated_at: string | null;
        };
        Insert: {
          acceptance_rate?: number | null;
          avatar?: string | null;
          badges?: Json | null;
          contest_global_ranking?: number | null;
          contest_rating?: number | null;
          contest_top_percentage?: number | null;
          contests_attended?: number | null;
          country?: string | null;
          easy_solved?: number | null;
          easy_total?: number | null;
          hard_solved?: number | null;
          hard_total?: number | null;
          language_stats?: Json | null;
          medium_solved?: number | null;
          medium_total?: number | null;
          ranking?: number | null;
          real_name?: string | null;
          streak?: number | null;
          student_id?: string | null;
          submission_calendar?: Json | null;
          tag_stats?: Json | null;
          total_active_days?: number | null;
          total_questions?: number | null;
          total_solved?: number | null;
          updated_at?: string | null;
        };
        Update: {
          acceptance_rate?: number | null;
          avatar?: string | null;
          badges?: Json | null;
          contest_global_ranking?: number | null;
          contest_rating?: number | null;
          contest_top_percentage?: number | null;
          contests_attended?: number | null;
          country?: string | null;
          easy_solved?: number | null;
          easy_total?: number | null;
          hard_solved?: number | null;
          hard_total?: number | null;
          language_stats?: Json | null;
          medium_solved?: number | null;
          medium_total?: number | null;
          ranking?: number | null;
          real_name?: string | null;
          streak?: number | null;
          student_id?: string | null;
          submission_calendar?: Json | null;
          tag_stats?: Json | null;
          total_active_days?: number | null;
          total_questions?: number | null;
          total_solved?: number | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "student_stats_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: true;
            referencedRelation: "student_scores";
            referencedColumns: ["student_id"];
          },
          {
            foreignKeyName: "student_stats_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: true;
            referencedRelation: "students";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "student_stats_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: true;
            referencedRelation: "students_public";
            referencedColumns: ["id"];
          },
        ];
      };
      students_public: {
        Row: {
          created_at: string | null;
          id: string | null;
          last_scraped_at: string | null;
          leetcode_id: string | null;
          name: string | null;
          roll: string | null;
          scrape_error: string | null;
        };
        Insert: {
          created_at?: string | null;
          id?: string | null;
          last_scraped_at?: string | null;
          leetcode_id?: string | null;
          name?: string | null;
          roll?: string | null;
          scrape_error?: string | null;
        };
        Update: {
          created_at?: string | null;
          id?: string | null;
          last_scraped_at?: string | null;
          leetcode_id?: string | null;
          name?: string | null;
          roll?: string | null;
          scrape_error?: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      claim_refresh_job: {
        Args: { p_job_id: string; p_lease_seconds?: number; p_owner?: string };
        Returns: Json;
      };
      classroom_delete_preview: {
        Args: { p_classroom: string };
        Returns: {
          orphan_count: number;
          shared_count: number;
        }[];
      };
      classroom_student_counts: {
        Args: { p_classroom_ids?: string[] };
        Returns: {
          classroom_id: string;
          student_count: number;
        }[];
      };
      classroom_student_page: {
        Args: {
          p_classroom_id: string;
          p_cursor?: string;
          p_limit?: number;
          p_max_failures?: number;
        };
        Returns: {
          consecutive_failures: number;
          id: string;
        }[];
      };
      commit_platform_batch: {
        Args: {
          p_clean_streak: number;
          p_cooldown_ms: number;
          p_done?: boolean;
          p_errors?: Json;
          p_est_batch_ms?: number;
          p_expected_cursor: string;
          p_failed: number;
          p_job_id: string;
          p_new_cursor: string;
          p_ok: number;
          p_owner: string;
        };
        Returns: boolean;
      };
      commit_refresh_batch: {
        Args: {
          p_clean_streak: number;
          p_cooldown_ms: number;
          p_done?: boolean;
          p_errors?: Json;
          p_expected_cursor: string;
          p_failed: number;
          p_job_id: string;
          p_new_cursor: string;
          p_ok: number;
          p_owner: string;
        };
        Returns: boolean;
      };
      delete_classroom_cascade: {
        Args: { p_classroom: string };
        Returns: {
          memberships_removed: number;
          students_deleted: number;
        }[];
      };
      distinct_student_count: {
        Args: { p_classroom_ids?: string[] };
        Returns: number;
      };
      duplicate_students: {
        Args: never;
        Returns: {
          kind: string;
          student_count: number;
          students: Json;
          value: string;
        }[];
      };
      enqueue_platform_refresh_job: {
        Args: {
          p_classroom_id?: string;
          p_created_by?: string;
          p_filter?: string;
          p_force?: boolean;
          p_platform_id: string;
          p_scope?: string;
          p_stale_before?: string;
          p_student_ids?: string[];
        };
        Returns: string;
      };
      enqueue_refresh_job: {
        Args: {
          p_classroom_id?: string;
          p_created_by?: string;
          p_filter?: string;
          p_force?: boolean;
          p_scope: string;
          p_stale_before?: string;
          p_student_ids?: string[];
        };
        Returns: string;
      };
      first_snapshot_per_platform: {
        Args: { p_student_ids: string[] };
        Returns: {
          first_date: string;
          platform_id: string;
        }[];
      };
      grant_role: {
        Args: { _email: string; _role: Database["public"]["Enums"]["app_role"] };
        Returns: boolean;
      };
      has_classroom_access: {
        Args: { _classroom: string; _user: string };
        Returns: boolean;
      };
      has_college_access: {
        Args: { _college: string; _user: string };
        Returns: boolean;
      };
      has_role: {
        Args: { _role: Database["public"]["Enums"]["app_role"]; _user: string };
        Returns: boolean;
      };
      has_student_access: {
        Args: { _student: string; _user: string };
        Returns: boolean;
      };
      merge_students: {
        Args: { p_loser: string; p_survivor: string };
        Returns: {
          memberships_moved: number;
          snapshots_moved: number;
        }[];
      };
      next_platform_job: { Args: never; Returns: string };
      platform_account_page: {
        Args: {
          p_classroom_id?: string;
          p_cursor?: string;
          p_limit?: number;
          p_max_failures?: number;
          p_platform_id: string;
          p_scope?: string;
          p_stale_before?: string;
          p_student_ids?: string[];
        };
        Returns: {
          account_id: string;
          handle: string;
          student_id: string;
          sync_cursor: Json;
        }[];
      };
      release_refresh_job: {
        Args: { p_job_id: string; p_owner: string };
        Returns: boolean;
      };
      remove_student_from_classroom: {
        Args: { p_classroom: string; p_student: string };
        Returns: {
          remaining_classrooms: number;
          student_deleted: boolean;
        }[];
      };
      student_ranks: {
        Args: { p_student_ids: string[] };
        Returns: {
          classroom_ranks: Json;
          college_rank: number;
          college_total: number;
          student_id: string;
        }[];
      };
      student_ranks_v2: {
        Args: { p_student_ids: string[] };
        Returns: {
          almanac_score: number;
          classroom_ranks: Json;
          college_id: string;
          college_name: string;
          college_rank: number;
          college_total: number;
          overall_rank: number;
          overall_total: number;
          platform_ranks: Json;
          score_breakdown: Json;
          student_id: string;
        }[];
      };
    };
    Enums: {
      app_role: "admin" | "placement_officer" | "faculty" | "ceo";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: ["admin", "placement_officer", "faculty", "ceo"],
    },
  },
} as const;
