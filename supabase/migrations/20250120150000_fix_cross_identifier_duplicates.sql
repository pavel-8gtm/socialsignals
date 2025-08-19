-- Fix cross-identifier duplicates that the previous migration missed
-- This handles cases where one profile has primary_identifier and another has only secondary_identifier
-- but they represent the same person

-- Find and merge profiles that have matching secondary_identifier but different primary_identifier status
CREATE OR REPLACE FUNCTION merge_cross_identifier_duplicates() RETURNS void AS $$
DECLARE
  duplicate_group RECORD;
  canonical_profile RECORD;
  duplicate_ids UUID[];
BEGIN
  -- Find groups of profiles with same secondary_identifier but mixed primary_identifier status
  FOR duplicate_group IN
    SELECT 
      secondary_identifier,
      array_agg(id ORDER BY 
        CASE WHEN primary_identifier IS NOT NULL THEN 0 ELSE 1 END, -- Prioritize profiles with primary_identifier
        enriched_at DESC NULLS LAST, -- Then prioritize enriched profiles
        first_seen ASC -- Finally, oldest first
      ) as profile_ids,
      COUNT(*) as profile_count
    FROM profiles 
    WHERE secondary_identifier IS NOT NULL
    GROUP BY secondary_identifier 
    HAVING COUNT(*) > 1
  LOOP
    -- Get the canonical profile (first in ordered array)
    SELECT INTO canonical_profile id, name, primary_identifier, secondary_identifier, enriched_at, profile_pictures, headline
    FROM profiles 
    WHERE id = duplicate_group.profile_ids[1];
    
    -- Get the duplicate IDs (all except the first)
    duplicate_ids := duplicate_group.profile_ids[2:];
    
    RAISE NOTICE 'Processing duplicates for secondary_identifier: % (canonical: %, duplicates: %)', 
      duplicate_group.secondary_identifier, canonical_profile.id, duplicate_ids;
    
    -- Update reactions to point to canonical profile
    UPDATE reactions 
    SET reactor_profile_id = canonical_profile.id 
    WHERE reactor_profile_id = ANY(duplicate_ids);
    
    -- Update comments to point to canonical profile
    UPDATE comments 
    SET commenter_profile_id = canonical_profile.id 
    WHERE commenter_profile_id = ANY(duplicate_ids);
    
    -- Update canonical profile timestamp
    UPDATE profiles SET last_updated = NOW() WHERE id = canonical_profile.id;
    
    -- Delete duplicate profiles
    DELETE FROM profiles WHERE id = ANY(duplicate_ids);
    
    RAISE NOTICE 'Merged % duplicates for secondary_identifier: % (kept profile: %)', 
      array_length(duplicate_ids, 1), duplicate_group.secondary_identifier, canonical_profile.name;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Execute the cross-identifier merge function
SELECT merge_cross_identifier_duplicates();

-- Drop the temporary function
DROP FUNCTION merge_cross_identifier_duplicates();

-- Verify results
DO $$
DECLARE
  duplicate_count INTEGER;
BEGIN
  -- Check for remaining duplicates by secondary_identifier
  SELECT COUNT(*) INTO duplicate_count
  FROM (
    SELECT secondary_identifier, COUNT(*) as cnt
    FROM profiles 
    WHERE secondary_identifier IS NOT NULL
    GROUP BY secondary_identifier 
    HAVING COUNT(*) > 1
  ) duplicates;
  
  IF duplicate_count > 0 THEN
    RAISE NOTICE 'WARNING: % secondary_identifier duplicates still exist', duplicate_count;
  ELSE
    RAISE NOTICE 'SUCCESS: No secondary_identifier duplicates found';
  END IF;
END;
$$;
