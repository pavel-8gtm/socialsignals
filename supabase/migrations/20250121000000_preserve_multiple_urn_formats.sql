-- Migration to help preserve multiple URN formats for the same person
-- This addresses the issue where LinkedIn sometimes returns different URN formats
-- for the same person (e.g., 'balazsvajna' vs 'ACoAABxxxxxx')
-- and we need to track both to avoid losing reactions/comments

-- First, let's add a new field to track alternative URN formats
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS alternative_urns JSONB DEFAULT NULL;

-- Add index for alternative_urns for better performance
CREATE INDEX IF NOT EXISTS idx_profiles_alternative_urns_gin ON profiles USING gin(alternative_urns);

-- Create a function to safely add alternative URNs
CREATE OR REPLACE FUNCTION add_alternative_urn(profile_id UUID, new_urn TEXT) 
RETURNS void AS $$
BEGIN
  -- Only add if the URN is different from the main urn and not already in alternatives
  IF new_urn IS NOT NULL AND new_urn != '' THEN
    UPDATE profiles 
    SET alternative_urns = CASE
      WHEN alternative_urns IS NULL THEN jsonb_build_array(new_urn)
      WHEN NOT alternative_urns ? new_urn THEN alternative_urns || jsonb_build_array(new_urn)
      ELSE alternative_urns
    END,
    last_updated = NOW()
    WHERE id = profile_id 
      AND (urn IS NULL OR urn != new_urn)
      AND (alternative_urns IS NULL OR NOT alternative_urns ? new_urn);
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Create a function to find all URNs (main + alternatives) for a profile
CREATE OR REPLACE FUNCTION get_all_urns_for_profile(profile_id UUID) 
RETURNS TEXT[] AS $$
DECLARE
  main_urn TEXT;
  alt_urns JSONB;
  all_urns TEXT[] := ARRAY[]::TEXT[];
BEGIN
  SELECT urn, alternative_urns INTO main_urn, alt_urns
  FROM profiles WHERE id = profile_id;
  
  -- Add main URN if it exists
  IF main_urn IS NOT NULL AND main_urn != '' THEN
    all_urns := array_append(all_urns, main_urn);
  END IF;
  
  -- Add alternative URNs if they exist
  IF alt_urns IS NOT NULL THEN
    SELECT array_agg(value::text) INTO all_urns 
    FROM (
      SELECT unnest(all_urns) AS existing_urn
      UNION
      SELECT value::text FROM jsonb_array_elements_text(alt_urns)
    ) combined
    WHERE value IS NOT NULL AND value != '';
  END IF;
  
  RETURN all_urns;
END;
$$ LANGUAGE plpgsql;

-- Create a function to search for profiles by any URN format
CREATE OR REPLACE FUNCTION find_profile_by_any_urn(search_urn TEXT) 
RETURNS UUID AS $$
DECLARE
  profile_id UUID;
BEGIN
  -- First try exact match on main urn
  SELECT id INTO profile_id FROM profiles WHERE urn = search_urn LIMIT 1;
  
  IF profile_id IS NOT NULL THEN
    RETURN profile_id;
  END IF;
  
  -- Then try alternative URNs
  SELECT id INTO profile_id 
  FROM profiles 
  WHERE alternative_urns ? search_urn 
  LIMIT 1;
  
  IF profile_id IS NOT NULL THEN
    RETURN profile_id;
  END IF;
  
  -- Finally try primary/secondary identifiers
  SELECT id INTO profile_id 
  FROM profiles 
  WHERE primary_identifier = search_urn OR secondary_identifier = search_urn
  LIMIT 1;
  
  RETURN profile_id;
END;
$$ LANGUAGE plpgsql;

-- Find potential cases where we might have lost URN tracking
-- Look for profiles that have reactions/comments but might have had their URN overwritten
DO $$
DECLARE
  stats_record RECORD;
  potential_issues INTEGER := 0;
BEGIN
  -- Check for reactions that might be linked to profiles with mismatched URNs
  -- This would indicate we may have overwritten URNs in the past
  
  -- Just log some statistics for now
  SELECT COUNT(DISTINCT p.id) as profiles_with_reactions,
         COUNT(DISTINCT r.reactor_profile_id) as distinct_reactor_profiles
  INTO stats_record
  FROM profiles p
  LEFT JOIN reactions r ON p.id = r.reactor_profile_id;
  
  RAISE NOTICE 'URN Preservation Migration Applied:';
  RAISE NOTICE '- Added alternative_urns field to track multiple URN formats';
  RAISE NOTICE '- Added helper functions for URN management';
  RAISE NOTICE '- Current stats: % profiles have reactions, % distinct reactor profiles', 
    stats_record.profiles_with_reactions, 
    stats_record.distinct_reactor_profiles;
  RAISE NOTICE 'Going forward, multiple URN formats will be preserved automatically';
END;
$$;

-- Add a comment to document this enhancement
COMMENT ON COLUMN profiles.alternative_urns IS 'Stores alternative URN formats for the same person (JSON array). Used when LinkedIn returns different URN formats (vanity vs internal ID) for the same profile.';
COMMENT ON FUNCTION add_alternative_urn(UUID, TEXT) IS 'Safely adds an alternative URN format to a profile without duplicating existing URNs.';
COMMENT ON FUNCTION get_all_urns_for_profile(UUID) IS 'Returns all URN formats (main + alternatives) associated with a profile.';
COMMENT ON FUNCTION find_profile_by_any_urn(TEXT) IS 'Finds a profile by searching across main URN, alternative URNs, and identifier fields.';
