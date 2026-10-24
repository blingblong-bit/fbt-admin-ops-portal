ALTER TABLE public.schedule_hides ADD COLUMN kind text NOT NULL DEFAULT 'hide';
ALTER TABLE public.schedule_hides ADD CONSTRAINT schedule_hides_kind_check CHECK (kind IN ('hide','pin'));
COMMENT ON COLUMN public.schedule_hides.kind IS 'hide = staff hid client; pin = staff restored an auto-hidden client until new activity';