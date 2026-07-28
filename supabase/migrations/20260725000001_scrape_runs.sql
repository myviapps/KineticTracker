-- Track every scrape run (cron, platform, classroom, student)
CREATE TABLE public.scrape_runs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('cron', 'platform', 'classroom', 'student')),
  classroom_id UUID REFERENCES public.classrooms(id) ON DELETE SET NULL,
  student_id UUID REFERENCES public.students(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  total_students INT NOT NULL DEFAULT 0,
  success_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0,
  errors JSONB
);

CREATE INDEX scrape_runs_started_at_idx ON public.scrape_runs(started_at DESC);
CREATE INDEX scrape_runs_source_idx ON public.scrape_runs(source);

GRANT SELECT ON public.scrape_runs TO authenticated;
GRANT ALL ON public.scrape_runs TO service_role;

ALTER TABLE public.scrape_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scrape_runs read for all authenticated" ON public.scrape_runs FOR SELECT USING (true);
