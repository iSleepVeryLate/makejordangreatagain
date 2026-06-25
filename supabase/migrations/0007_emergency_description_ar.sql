-- =====================================================================
-- Add an Arabic description column to emergency_numbers. Run after 0006.
-- (tourism_spots and gov_services already carry summary_ar.)
-- =====================================================================
alter table public.emergency_numbers add column if not exists description_ar text;
