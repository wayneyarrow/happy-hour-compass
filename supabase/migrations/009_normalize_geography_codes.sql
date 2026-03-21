-- Normalize geography codes to use canonical ISO/province values.
-- country: use ISO 2-letter code (e.g. CA, US) — not full name
-- region:  use province/state code (e.g. BC, AB, WA) — not full name

-- 1. Full country name → ISO code
UPDATE venues SET country = 'CA' WHERE country = 'Canada';
UPDATE venues SET country = 'US' WHERE country = 'United States';

-- 2. Null country → canonical code (backfill; all current venues are Canadian)
--    If new non-CA venues are added later, omit this or scope it more narrowly.
UPDATE venues SET country = 'CA' WHERE country IS NULL;

-- 3. Null region for CA venues → province code
--    All current CA venues are in British Columbia.
UPDATE venues SET region = 'BC' WHERE country = 'CA' AND region IS NULL;
