-- Comprehensive fix for duplicate profiles and identifier population
-- This migration addresses the root cause of duplicate profiles by:
-- 1. Populating missing primary_identifier and secondary_identifier fields
-- 2. Merging duplicate profiles based on the new dual identifier system
-- 3. Updating all references to point to the canonical profile

-- Step 1: Populate missing identifier fields for existing profiles
UPDATE profiles 
SET 
  primary_identifier = CASE 
    -- If URN looks like LinkedIn internal ID, use as primary
    WHEN urn ~ '^ACoA[A-Za-z0-9_-]+$' THEN urn
    -- If profile_url contains an internal ID, extract it
    WHEN profile_url ~ '/in/ACoA[A-Za-z0-9_-]+' THEN 
      substring(profile_url from '/in/(ACoA[A-Za-z0-9_-]+)')
    ELSE NULL
  END,
  secondary_identifier = CASE
    -- If URN is a vanity URL (not internal ID), use as secondary
    WHEN urn NOT LIKE 'ACoA%' AND urn NOT LIKE 'https://%' AND urn IS NOT NULL THEN urn
    -- Extract vanity URL from profile_url if it's not an internal ID
    WHEN profile_url ~ '/in/[^/ACoA][^/]*$' THEN 
      substring(profile_url from '/in/([^/ACoA][^/]*)$')
    -- Extract from full profile URL in urn field
    WHEN urn LIKE 'https://www.linkedin.com/in/%' THEN
      substring(urn from '/in/([^/?]+)')
    ELSE NULL
  END
WHERE primary_identifier IS NULL OR secondary_identifier IS NULL;

-- Step 2: Find and merge duplicate profiles
-- Create a temporary function to merge duplicates
CREATE OR REPLACE FUNCTION merge_duplicate_profiles() RETURNS void AS $$
DECLARE
  duplicate_record RECORD;
  canonical_id UUID;
  duplicate_ids UUID[];
BEGIN
  -- Find profiles that have the same primary_identifier but different IDs
  FOR duplicate_record IN
    SELECT primary_identifier, array_agg(id ORDER BY first_seen ASC) as profile_ids
    FROM profiles 
    WHERE primary_identifier IS NOT NULL
    GROUP BY primary_identifier 
    HAVING count(*) > 1
  LOOP
    canonical_id := duplicate_record.profile_ids[1]; -- Keep the oldest
    duplicate_ids := duplicate_record.profile_ids[2:]; -- Remove the rest
    
    -- Update reactions to point to canonical profile
    UPDATE reactions 
    SET reactor_profile_id = canonical_id 
    WHERE reactor_profile_id = ANY(duplicate_ids);
    
    -- Update comments to point to canonical profile
    UPDATE comments 
    SET commenter_profile_id = canonical_id 
    WHERE commenter_profile_id = ANY(duplicate_ids);
    
    -- Delete duplicate profiles
    DELETE FROM profiles WHERE id = ANY(duplicate_ids);
    
    RAISE NOTICE 'Merged % duplicates for primary_identifier: %', array_length(duplicate_ids, 1), duplicate_record.primary_identifier;
  END LOOP;
  
  -- Find profiles that have the same secondary_identifier but different IDs (and no primary_identifier match)
  FOR duplicate_record IN
    SELECT secondary_identifier, array_agg(id ORDER BY first_seen ASC) as profile_ids
    FROM profiles 
    WHERE secondary_identifier IS NOT NULL
      AND primary_identifier IS NULL  -- Only process profiles without primary identifier
    GROUP BY secondary_identifier 
    HAVING count(*) > 1
  LOOP
    canonical_id := duplicate_record.profile_ids[1]; -- Keep the oldest
    duplicate_ids := duplicate_record.profile_ids[2:]; -- Remove the rest
    
    -- Update reactions to point to canonical profile
    UPDATE reactions 
    SET reactor_profile_id = canonical_id 
    WHERE reactor_profile_id = ANY(duplicate_ids);
    
    -- Update comments to point to canonical profile
    UPDATE comments 
    SET commenter_profile_id = canonical_id 
    WHERE commenter_profile_id = ANY(duplicate_ids);
    
    -- Delete duplicate profiles
    DELETE FROM profiles WHERE id = ANY(duplicate_ids);
    
    RAISE NOTICE 'Merged % duplicates for secondary_identifier: %', array_length(duplicate_ids, 1), duplicate_record.secondary_identifier;
  END LOOP;
  
  -- Find profiles that have the same name and similar profile URLs (final cleanup)
  FOR duplicate_record IN
    SELECT name, array_agg(id ORDER BY enriched_at DESC NULLS LAST, first_seen ASC) as profile_ids
    FROM profiles 
    WHERE name IS NOT NULL
      AND primary_identifier IS NULL  -- Only process profiles without identifiers
      AND secondary_identifier IS NULL
    GROUP BY name 
    HAVING count(*) > 1
  LOOP
    canonical_id := duplicate_record.profile_ids[1]; -- Keep the most enriched/oldest
    duplicate_ids := duplicate_record.profile_ids[2:]; -- Remove the rest
    
    -- Update reactions to point to canonical profile
    UPDATE reactions 
    SET reactor_profile_id = canonical_id 
    WHERE reactor_profile_id = ANY(duplicate_ids);
    
    -- Update comments to point to canonical profile
    UPDATE comments 
    SET commenter_profile_id = canonical_id 
    WHERE commenter_profile_id = ANY(duplicate_ids);
    
    -- Delete duplicate profiles
    DELETE FROM profiles WHERE id = ANY(duplicate_ids);
    
    RAISE NOTICE 'Merged % duplicates for name: %', array_length(duplicate_ids, 1), duplicate_record.name;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Execute the merge function
SELECT merge_duplicate_profiles();

-- Drop the temporary function
DROP FUNCTION merge_duplicate_profiles();

-- Step 3: Add indexes for better performance on the new identifier fields
CREATE INDEX IF NOT EXISTS idx_profiles_primary_identifier ON profiles(primary_identifier) WHERE primary_identifier IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_secondary_identifier ON profiles(secondary_identifier) WHERE secondary_identifier IS NOT NULL;

-- Step 4: Update any remaining profiles to populate identifiers from URN if still missing
UPDATE profiles 
SET 
  primary_identifier = CASE 
    WHEN urn ~ '^ACoA[A-Za-z0-9_-]+$' AND primary_identifier IS NULL THEN urn
    ELSE primary_identifier
  END,
  secondary_identifier = CASE
    WHEN urn NOT LIKE 'ACoA%' AND urn NOT LIKE 'https://%' AND urn IS NOT NULL AND secondary_identifier IS NULL THEN urn
    ELSE secondary_identifier
  END
WHERE primary_identifier IS NULL OR secondary_identifier IS NULL;

-- Add a comment to track this migration
COMMENT ON TABLE profiles IS 'LinkedIn profiles with dual identifier system for robust deduplication. Updated with comprehensive duplicate cleanup on 2025-01-20.';
