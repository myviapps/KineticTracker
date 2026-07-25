-- Create site_settings table
CREATE TABLE public.site_settings (
    id integer PRIMARY KEY CHECK (id = 1),
    google_auth_enabled boolean NOT NULL DEFAULT true,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

-- Allow read access to all users (since the login page needs to check if google auth is enabled before logging in, we need to allow anon access too!)
CREATE POLICY "Allow public read access to site_settings"
    ON public.site_settings FOR SELECT
    USING (true);

-- Allow updates only by admins
CREATE POLICY "Allow admins to update site_settings"
    ON public.site_settings FOR UPDATE
    TO authenticated
    USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Insert default row
INSERT INTO public.site_settings (id, google_auth_enabled) VALUES (1, true);

-- Add trigger to update updated_at
CREATE TRIGGER update_site_settings_updated_at
    BEFORE UPDATE ON public.site_settings
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();
