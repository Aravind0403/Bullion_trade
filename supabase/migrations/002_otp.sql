-- Migration 002: Add OTP columns to organizations
-- Run this in Supabase Dashboard → SQL Editor

ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS otp_enabled     BOOLEAN      DEFAULT false,
    ADD COLUMN IF NOT EXISTS otp_email       TEXT,
    ADD COLUMN IF NOT EXISTS otp_code        TEXT,
    ADD COLUMN IF NOT EXISTS otp_expires_at  TIMESTAMPTZ;

-- Note: otp_code and otp_expires_at are read/written only by Edge Functions
-- (service role key). The client reads otp_enabled + otp_email only.
-- For tighter security in future: move otp_code/otp_expires_at to a
-- separate otp_challenges table with stricter RLS.
