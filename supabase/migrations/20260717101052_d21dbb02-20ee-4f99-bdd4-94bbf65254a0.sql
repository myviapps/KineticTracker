
-- classrooms
CREATE TABLE public.classrooms (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.classrooms TO anon, authenticated;
GRANT ALL ON public.classrooms TO service_role;
ALTER TABLE public.classrooms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "classrooms public read" ON public.classrooms FOR SELECT USING (true);

-- students
CREATE TABLE public.students (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  classroom_id UUID NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  roll TEXT NOT NULL,
  email TEXT,
  leetcode_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_scraped_at TIMESTAMPTZ,
  scrape_error TEXT,
  UNIQUE(classroom_id, roll)
);
CREATE INDEX students_classroom_idx ON public.students(classroom_id);
CREATE INDEX students_roll_idx ON public.students(roll);
GRANT SELECT ON public.students TO anon, authenticated;
GRANT ALL ON public.students TO service_role;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
CREATE POLICY "students public read" ON public.students FOR SELECT USING (true);

-- student_stats (latest snapshot, 1:1)
CREATE TABLE public.student_stats (
  student_id UUID NOT NULL PRIMARY KEY REFERENCES public.students(id) ON DELETE CASCADE,
  real_name TEXT,
  avatar TEXT,
  country TEXT,
  reputation INT DEFAULT 0,
  ranking BIGINT,
  total_solved INT DEFAULT 0,
  total_questions INT DEFAULT 0,
  easy_solved INT DEFAULT 0,
  easy_total INT DEFAULT 0,
  medium_solved INT DEFAULT 0,
  medium_total INT DEFAULT 0,
  hard_solved INT DEFAULT 0,
  hard_total INT DEFAULT 0,
  acceptance_rate NUMERIC,
  streak INT DEFAULT 0,
  total_active_days INT DEFAULT 0,
  contest_rating NUMERIC,
  contest_global_ranking BIGINT,
  contests_attended INT,
  contest_top_percentage NUMERIC,
  submission_calendar JSONB,
  language_stats JSONB,
  tag_stats JSONB,
  badges JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.student_stats TO anon, authenticated;
GRANT ALL ON public.student_stats TO service_role;
ALTER TABLE public.student_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "student_stats public read" ON public.student_stats FOR SELECT USING (true);

-- daily_snapshots (one per student per day)
CREATE TABLE public.daily_snapshots (
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  total_solved INT NOT NULL DEFAULT 0,
  easy_solved INT NOT NULL DEFAULT 0,
  medium_solved INT NOT NULL DEFAULT 0,
  hard_solved INT NOT NULL DEFAULT 0,
  solved_that_day INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, snapshot_date)
);
CREATE INDEX daily_snapshots_date_idx ON public.daily_snapshots(snapshot_date);
GRANT SELECT ON public.daily_snapshots TO anon, authenticated;
GRANT ALL ON public.daily_snapshots TO service_role;
ALTER TABLE public.daily_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "daily_snapshots public read" ON public.daily_snapshots FOR SELECT USING (true);

-- recent_submissions (replaced per refresh)
CREATE TABLE public.recent_submissions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  title_slug TEXT NOT NULL,
  lang TEXT,
  submitted_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX recent_submissions_student_idx ON public.recent_submissions(student_id, submitted_at DESC);
GRANT SELECT ON public.recent_submissions TO anon, authenticated;
GRANT ALL ON public.recent_submissions TO service_role;
ALTER TABLE public.recent_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "recent_submissions public read" ON public.recent_submissions FOR SELECT USING (true);
