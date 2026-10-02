/*
# Create profiles table with role-based access control

1. New Tables
   - `profiles`
     - `id` (uuid, primary key, references auth.users) — links each profile to a Supabase Auth user
     - `full_name` (text, not null) — student or admin display name
     - `student_id` (text, unique) — university-issued student ID (NULL for admins)
     - `email` (text, unique, not null) — must match the auth.users email
     - `role` (text, not null, default 'STUDENT') — 'STUDENT' or 'ADMIN'
     - `is_active` (boolean, default true) — admin can disable a student
     - `total_points` (integer, default 0) — accumulated competition score
     - `problems_solved` (integer, default 0) — count of unique problems solved
     - `problems_attempted` (integer, default 0) — count of problems attempted
     - `created_at` (timestamptz, default now())
     - `updated_at` (timestamptz, default now())

2. Security
   - RLS enabled on `profiles`.
   - Students can SELECT their own profile; admins can SELECT all.
   - Students can UPDATE their own profile but only safe fields (full_name) via column privileges.
   - Admins can UPDATE any profile (is_active, role).
   - No INSERT policy — profiles are created by a trigger on auth.users signup.

3. Important Notes
   - The `handle_new_user` trigger creates a profile row automatically when a user signs up.
   - Role defaults to STUDENT. Admins are created manually and then promoted to ADMIN.
   - Column-level privileges restrict students from modifying server-controlled fields.
*/

-- Profiles table (must exist before is_admin function)
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  student_id text UNIQUE,
  email text UNIQUE NOT NULL,
  role text NOT NULL DEFAULT 'STUDENT' CHECK (role IN ('STUDENT', 'ADMIN')),
  is_active boolean DEFAULT true,
  total_points integer DEFAULT 0,
  problems_solved integer DEFAULT 0,
  problems_attempted integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Helper function to check if current user is admin (created after table)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'ADMIN'
  );
$$;

-- Students can read their own profile; admins can read all
DROP POLICY IF EXISTS "select_own_or_admin_profiles" ON public.profiles;
CREATE POLICY "select_own_or_admin_profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.is_admin());

-- Students can update their own profile
DROP POLICY IF EXISTS "update_own_profile" ON public.profiles;
CREATE POLICY "update_own_profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Admins can update any profile
DROP POLICY IF EXISTS "admin_update_profile" ON public.profiles;
CREATE POLICY "admin_update_profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Trigger function to create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, student_id, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'New User'),
    NEW.raw_user_meta_data->>'student_id',
    NEW.email,
    'STUDENT'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Function to update updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_updated_at ON public.profiles;
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Column-level privileges: students can only update full_name, not server-controlled fields
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (full_name) ON public.profiles TO authenticated;
GRANT SELECT ON public.profiles TO authenticated;
