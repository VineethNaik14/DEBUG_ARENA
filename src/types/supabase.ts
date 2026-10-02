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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      competitions: {
        Row: {
          created_at: string
          description: string | null
          duration: number | null
          end_time: string | null
          id: string
          maximum_attempts: number
          name: string
          penalty_rules: Json
          start_time: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          duration?: number | null
          end_time?: string | null
          id?: string
          maximum_attempts?: number
          name: string
          penalty_rules?: Json
          start_time?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          duration?: number | null
          end_time?: string | null
          id?: string
          maximum_attempts?: number
          name?: string
          penalty_rules?: Json
          start_time?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          message: string
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          message: string
          title: string
          type?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      problems: {
        Row: {
          buggy_code: string
          constraints: string
          created_at: string
          description: string
          difficulty: string
          expected_behavior: string
          id: string
          input_format: string
          is_active: boolean
          language: string
          max_points: number
          memory_limit_mb: number
          output_format: string
          problem_order: number
          round_number: number
          sample_input: string
          sample_output: string
          test_cases: Json
          time_limit_ms: number
          title: string
          updated_at: string
        }
        Insert: {
          buggy_code?: string
          constraints?: string
          created_at?: string
          description: string
          difficulty?: string
          expected_behavior?: string
          id?: string
          input_format?: string
          is_active?: boolean
          language?: string
          max_points?: number
          memory_limit_mb?: number
          output_format?: string
          problem_order?: number
          round_number?: number
          sample_input?: string
          sample_output?: string
          test_cases?: Json
          time_limit_ms?: number
          title: string
          updated_at?: string
        }
        Update: {
          buggy_code?: string
          constraints?: string
          created_at?: string
          description?: string
          difficulty?: string
          expected_behavior?: string
          id?: string
          input_format?: string
          is_active?: boolean
          language?: string
          max_points?: number
          memory_limit_mb?: number
          output_format?: string
          problem_order?: number
          round_number?: number
          sample_input?: string
          sample_output?: string
          test_cases?: Json
          time_limit_ms?: number
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string
          id: string
          is_active: boolean
          problems_attempted: number
          problems_solved: number
          role: string
          student_id: string | null
          total_points: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name: string
          id: string
          is_active?: boolean
          problems_attempted?: number
          problems_solved?: number
          role?: string
          student_id?: string | null
          total_points?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          is_active?: boolean
          problems_attempted?: number
          problems_solved?: number
          role?: string
          student_id?: string | null
          total_points?: number
          updated_at?: string
        }
        Relationships: []
      }
      solved_problems: {
        Row: {
          id: string
          problem_id: string
          score: number
          solved_at: string
          user_id: string
        }
        Insert: {
          id?: string
          problem_id: string
          score?: number
          solved_at?: string
          user_id: string
        }
        Update: {
          id?: string
          problem_id?: string
          score?: number
          solved_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "solved_problems_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: false
            referencedRelation: "problems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solved_problems_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      submissions: {
        Row: {
          code: string
          competition_id: string | null
          created_at: string
          error_message: string | null
          execution_time_ms: number | null
          id: string
          language: string
          memory_used_mb: number | null
          passed_tests: number
          problem_id: string
          score: number
          status: string
          total_tests: number
          user_id: string
        }
        Insert: {
          code: string
          competition_id?: string | null
          created_at?: string
          error_message?: string | null
          execution_time_ms?: number | null
          id?: string
          language: string
          memory_used_mb?: number | null
          passed_tests?: number
          problem_id: string
          score?: number
          status?: string
          total_tests?: number
          user_id: string
        }
        Update: {
          code?: string
          competition_id?: string | null
          created_at?: string
          error_message?: string | null
          execution_time_ms?: number | null
          id?: string
          language?: string
          memory_used_mb?: number | null
          passed_tests?: number
          problem_id?: string
          score?: number
          status?: string
          total_tests?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "submissions_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: false
            referencedRelation: "problems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      student_problems: {
        Row: {
          buggy_code: string
          constraints: string
          created_at: string
          description: string
          difficulty: string
          expected_behavior: string
          id: string
          input_format: string
          is_active: boolean
          language: string
          max_points: number
          memory_limit_mb: number
          output_format: string
          problem_order: number
          round_number: number
          sample_input: string
          sample_output: string
          time_limit_ms: number
          title: string
          updated_at: string
          sample_test_cases: Json
        }
        Relationships: []
      }
    }
    Functions: {
      admin_save_competition: {
        Args: {
          p_description: string
          p_duration: number
          p_end_time: string
          p_id?: string
          p_maximum_attempts: number
          p_name: string
          p_start_time: string
        }
        Returns: {
          created_at: string
          description: string | null
          duration: number | null
          end_time: string | null
          id: string
          maximum_attempts: number
          name: string
          penalty_rules: Json
          start_time: string | null
          status: string
          updated_at: string
        }
      }
      admin_set_user_active: {
        Args: {
          p_active: boolean
          p_user_id: string
        }
        Returns: {
          created_at: string
          email: string
          full_name: string
          id: string
          is_active: boolean
          problems_attempted: number
          problems_solved: number
          role: string
          student_id: string | null
          total_points: number
          updated_at: string
        }
      }
      create_notification: {
        Args: {
          p_message: string
          p_title: string
          p_type?: string
          p_user_id: string
        }
        Returns: undefined
      }
      end_competition: {
        Args: {
          p_competition_id: string
        }
        Returns: undefined
      }
      finalize_submission: {
        Args: {
          p_error_message: string
          p_execution_time_ms: number
          p_memory_used_mb: number
          p_passed_tests: number
          p_status: string
          p_submission_id: string
          p_total_tests: number
        }
        Returns: {
          o_newly_solved: boolean
          o_score: number
        }[]
      }
      get_leaderboard: {
        Args: Record<PropertyKey, never>
        Returns: {
          full_name: string
          last_solve_time: string | null
          problems_solved: number
          rank: number
          student_id: string | null
          total_points: number
          user_id: string
        }[]
      }
      get_student_rank: {
        Args: {
          p_user_id: string
        }
        Returns: number
      }
      is_active_user: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      is_admin: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      is_valid_test_cases: {
        Args: {
          p: Json
        }
        Returns: boolean
      }
      reserve_submission: {
        Args: {
          p_code: string
          p_language: string
          p_problem_id: string
          p_user_id: string
        }
        Returns: {
          o_attempts_allowed: number
          o_attempts_used: number
          o_competition_id: string
          o_submission_id: string
        }[]
      }
      start_competition: {
        Args: {
          p_competition_id: string
        }
        Returns: undefined
      }
      student_id_available: {
        Args: {
          p_student_id: string
        }
        Returns: boolean
      }
      void_submission: {
        Args: {
          p_submission_id: string
        }
        Returns: undefined
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

type DefaultSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  TableName extends keyof DefaultSchema["Tables"],
> = DefaultSchema["Tables"][TableName]["Row"]

export type TablesInsert<
  TableName extends keyof DefaultSchema["Tables"],
> = DefaultSchema["Tables"][TableName]["Insert"]

export type TablesUpdate<
  TableName extends keyof DefaultSchema["Tables"],
> = DefaultSchema["Tables"][TableName]["Update"]
