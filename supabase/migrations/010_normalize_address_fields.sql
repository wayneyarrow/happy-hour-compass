-- Normalize address_line1 for Google-seeded rows that stored the full address blob.
--
-- Pattern imported from Google Places:
--   address_line1 = "<street>, <city>, BC <postal>"   postal_code = null
--
-- Target structure (matches manually-entered and Vancouver rows):
--   address_line1 = "<street only>"
--   postal_code   = "<VXX XYZ>"
--
-- This UPDATE is safe to replay: rows that no longer match the pattern
-- (already normalized) will simply not be matched.

UPDATE venues
SET
  postal_code   = regexp_replace(address_line1, '^.+,\s+[\w\s]+,\s+BC\s+([A-Z][0-9][A-Z]\s?[0-9][A-Z][0-9])$', '\1'),
  address_line1 = regexp_replace(address_line1, '^(.+?),\s+[\w\s]+,\s+BC\s+[A-Z][0-9][A-Z]\s?[0-9][A-Z][0-9]$', '\1')
WHERE
  postal_code IS NULL
  AND address_line1 IS NOT NULL
  AND address_line1 ~ '^.+,\s+[\w\s]+,\s+BC\s+[A-Z][0-9][A-Z]\s?[0-9][A-Z][0-9]$';
