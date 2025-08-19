-- Comprehensive deduplication to catch any remaining duplicates
-- This migration handles profiles created after the initial deduplication

BEGIN;

-- Function to merge duplicate profiles based on secondary_identifier
CREATE OR REPLACE FUNCTION merge_duplicate_profiles_by_secondary_id()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  duplicate_group RECORD;
  canonical_profile_id TEXT;
  duplicate_profile_id TEXT;
  merged_count INTEGER := 0;
BEGIN
  -- Find groups of profiles with the same secondary_identifier
  FOR duplicate_group IN
    SELECT secondary_identifier, COUNT(*) as profile_count
    FROM profiles 
    WHERE secondary_identifier IS NOT NULL 
      AND secondary_identifier != ''
    GROUP BY secondary_identifier 
    HAVING COUNT(*) > 1
  LOOP
    RAISE NOTICE 'Found % profiles with secondary_identifier: %', 
      duplicate_group.profile_count, duplicate_group.secondary_identifier;
    
    -- Select canonical profile (prefer enriched profiles, then older profiles)
    SELECT id INTO canonical_profile_id
    FROM profiles 
    WHERE secondary_identifier = duplicate_group.secondary_identifier
    ORDER BY 
      (first_name IS NOT NULL AND first_name != '') DESC,  -- Prefer enriched
      first_seen ASC NULLS LAST  -- Then prefer older
    LIMIT 1;
    
    RAISE NOTICE 'Canonical profile for %: %', duplicate_group.secondary_identifier, canonical_profile_id;
    
    -- Merge all other profiles into the canonical one
    FOR duplicate_profile_id IN
      SELECT id 
      FROM profiles 
      WHERE secondary_identifier = duplicate_group.secondary_identifier 
        AND id != canonical_profile_id
    LOOP
      RAISE NOTICE 'Merging duplicate profile % into canonical %', duplicate_profile_id, canonical_profile_id;
      
      -- Update comments
      UPDATE comments 
      SET commenter_profile_id = canonical_profile_id
      WHERE commenter_profile_id = duplicate_profile_id;
      
      -- Update reactions  
      UPDATE reactions 
      SET reactor_profile_id = canonical_profile_id
      WHERE reactor_profile_id = duplicate_profile_id;
      
      -- Store the duplicate URN as alternative
      PERFORM add_alternative_urn(
        (SELECT urn FROM profiles WHERE id = duplicate_profile_id),
        canonical_profile_id
      );
      
      -- Delete the duplicate
      DELETE FROM profiles WHERE id = duplicate_profile_id;
      
      merged_count := merged_count + 1;
    END LOOP;
  END LOOP;
  
  RETURN merged_count;
END;
$$;

-- Run the deduplication function
DO $$
DECLARE
  merged_profiles INTEGER;
BEGIN
  RAISE NOTICE 'Starting comprehensive profile deduplication...';
  SELECT merge_duplicate_profiles_by_secondary_id() INTO merged_profiles;
  RAISE NOTICE 'Deduplication complete. Merged % duplicate profiles.', merged_profiles;
END;
$$;

-- Create a trigger to prevent future duplicates on INSERT
CREATE OR REPLACE FUNCTION prevent_duplicate_profiles_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  existing_profile_id TEXT;
BEGIN
  -- Check if a profile with the same secondary_identifier already exists
  IF NEW.secondary_identifier IS NOT NULL AND NEW.secondary_identifier != '' THEN
    SELECT id INTO existing_profile_id
    FROM profiles 
    WHERE secondary_identifier = NEW.secondary_identifier
      AND id != COALESCE(NEW.id, '')
    LIMIT 1;
    
    IF existing_profile_id IS NOT NULL THEN
      RAISE NOTICE 'Preventing duplicate profile creation. Profile with secondary_identifier % already exists (ID: %)', 
        NEW.secondary_identifier, existing_profile_id;
      
      -- Instead of creating a duplicate, store the new URN as alternative
      PERFORM add_alternative_urn(NEW.urn, existing_profile_id);
      
      -- Return NULL to prevent the INSERT
      RETURN NULL;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create the trigger (only if it doesn't exist)
DROP TRIGGER IF EXISTS prevent_duplicate_profiles ON profiles;
CREATE TRIGGER prevent_duplicate_profiles
  BEFORE INSERT ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION prevent_duplicate_profiles_trigger();

-- Log completion
DO $$
BEGIN
  RAISE NOTICE 'Profile deduplication and prevention system complete!';
  RAISE NOTICE 'Future duplicate profiles will be automatically prevented.';
END;
$$;

COMMIT;
