-- Add last_enriched_at timestamp to track when profiles were successfully enriched
-- This helps users know when enrichment data was last updated

-- Add the new column
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_enriched_at TIMESTAMPTZ DEFAULT NULL;

-- Add index for performance when querying by enrichment date
CREATE INDEX IF NOT EXISTS idx_profiles_last_enriched_at ON profiles(last_enriched_at) WHERE last_enriched_at IS NOT NULL;

-- Set default date for existing enriched profiles (August 18th 2025 at 3pm UK time)
-- UK time in August is BST (UTC+1), so 3pm UK = 2pm UTC
UPDATE profiles 
SET last_enriched_at = '2025-08-18 14:00:00+00:00'::TIMESTAMPTZ
WHERE first_name IS NOT NULL 
  AND first_name != '' 
  AND last_enriched_at IS NULL;

-- Add comment to document the field
COMMENT ON COLUMN profiles.last_enriched_at IS 'Timestamp when the profile was last successfully enriched with LinkedIn data (first_name, company info, etc.)';

-- Log the migration results
DO $$
DECLARE
  total_profiles INTEGER;
  enriched_profiles INTEGER;
  updated_profiles INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_profiles FROM profiles;
  SELECT COUNT(*) INTO enriched_profiles FROM profiles WHERE first_name IS NOT NULL AND first_name != '';
  SELECT COUNT(*) INTO updated_profiles FROM profiles WHERE last_enriched_at = '2025-08-18 14:00:00+00:00'::TIMESTAMPTZ;
  
  RAISE NOTICE 'Last Enriched Timestamp Migration Complete:';
  RAISE NOTICE '- Total profiles: %', total_profiles;
  RAISE NOTICE '- Profiles with enrichment data: %', enriched_profiles;
  RAISE NOTICE '- Profiles updated with default enrichment date: %', updated_profiles;
  RAISE NOTICE '- Default date set to: August 18th 2025, 3:00 PM UK time (14:00 UTC)';
END;
$$;
