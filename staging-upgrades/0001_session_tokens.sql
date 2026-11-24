-- Proposed for the separate staging database. Commit before first session issuance.
ALTER TYPE public.token_purpose ADD VALUE 'session';
