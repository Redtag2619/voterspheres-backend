-- Build 6.0.2 - Normalize malformed candidate website values

UPDATE universal_candidate_entities
SET
  website = CASE
    WHEN website ~* '^https?://https?://'
      THEN REGEXP_REPLACE(
        website,
        '^https?://',
        '',
        'i'
      )
    WHEN website ~* '^\[https?://[^\]]+\]\(https?://[^)]+\)$'
      THEN SUBSTRING(
        website
        FROM '\((https?://[^)]+)\)'
      )
    ELSE website
  END,
  updated_at = NOW()
WHERE website ~* '^https?://https?://'
   OR website ~* '^\[https?://[^\]]+\]\(https?://[^)]+\)$';

UPDATE candidates
SET
  website = CASE
    WHEN website ~* '^https?://https?://'
      THEN REGEXP_REPLACE(
        website,
        '^https?://',
        '',
        'i'
      )
    WHEN website ~* '^\[https?://[^\]]+\]\(https?://[^)]+\)$'
      THEN SUBSTRING(
        website
        FROM '\((https?://[^)]+)\)'
      )
    ELSE website
  END,
  updated_at = NOW()
WHERE website ~* '^https?://https?://'
   OR website ~* '^\[https?://[^\]]+\]\(https?://[^)]+\)$';