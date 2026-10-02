/*
# Add round_number column to problems table

1. Changes
   - Add `round_number` column (integer, default 1) to `problems` table.
   - This allows admins to assign problems to Round 1, Round 2, or Round 3 of a competition.
   - Add index on round_number for efficient filtering.

2. Security
   - No RLS policy changes needed — the column is readable by students (same as other problem fields) and writable by admins (same as other problem fields).

3. Important Notes
   - Default value is 1 so all existing problems remain in Round 1.
   - Round values: 1, 2, or 3 (three rounds per competition).
   - Students will see problems grouped by round on the problem list page.
*/

ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS round_number integer DEFAULT 1;

-- Add CHECK constraint for valid round numbers
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'problems_round_number_check'
  ) THEN
    ALTER TABLE public.problems ADD CONSTRAINT problems_round_number_check CHECK (round_number IN (1, 2, 3));
  END IF;
END $$;

-- Add index for round-based filtering
CREATE INDEX IF NOT EXISTS idx_problems_round_number ON public.problems(round_number);
