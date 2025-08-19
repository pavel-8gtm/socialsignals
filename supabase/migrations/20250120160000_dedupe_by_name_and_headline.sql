-- Deduplication by name + headline combination
-- This catches edge cases where LinkedIn assigns different identifiers to the same person
-- but they have identical name and job title/headline

CREATE OR REPLACE FUNCTION merge_duplicates_by_name_headline() RETURNS void AS $$
DECLARE
  duplicate_group RECORD;
  canonical_profile RECORD;
  duplicate_ids UUID[];
BEGIN
  -- Find groups of profiles with same name AND headline but different IDs
  FOR duplicate_group IN
    SELECT 
      name,
      headline,
      array_agg(id ORDER BY 
        CASE WHEN enriched_at IS NOT NULL THEN 0 ELSE 1 END, -- Prioritize enriched profiles
        CASE WHEN primary_identifier IS NOT NULL THEN 0 ELSE 1 END, -- Then profiles with primary_identifier
        first_seen ASC -- Finally, oldest first
      ) as profile_ids,
      COUNT(*) as profile_count
    FROM profiles 
    WHERE name IS NOT NULL 
      AND headline IS NOT NULL
      AND trim(name) != ''
      AND trim(headline) != ''
    GROUP BY name, headline
    HAVING COUNT(*) > 1
  LOOP
    -- Get the canonical profile (first in ordered array)
    SELECT INTO canonical_profile 
      id, name, headline, primary_identifier, secondary_identifier, enriched_at, first_seen
    FROM profiles 
    WHERE id = duplicate_group.profile_ids[1];
    
    -- Get the duplicate IDs (all except the first)
    duplicate_ids := duplicate_group.profile_ids[2:];
    
    RAISE NOTICE 'Processing name+headline duplicates: "%" / "%" (canonical: %, duplicates: %)', 
      duplicate_group.name, 
      duplicate_group.headline,
      canonical_profile.id, 
      duplicate_ids;
    
    -- Check if any of the duplicates have better data (primary_identifier, enrichment) than canonical
    -- If so, we might want to swap which one is canonical
    DECLARE
      better_duplicate_id UUID := NULL;
      duplicate_profile RECORD;
    BEGIN
      -- Look for a duplicate that's better than canonical
      FOR i IN 1..array_length(duplicate_ids, 1) LOOP
        SELECT INTO duplicate_profile 
          id, primary_identifier, secondary_identifier, enriched_at, first_seen
        FROM profiles 
        WHERE id = duplicate_ids[i];
        
        -- Check if this duplicate is "better" than canonical
        IF (canonical_profile.enriched_at IS NULL AND duplicate_profile.enriched_at IS NOT NULL) OR
           (canonical_profile.primary_identifier IS NULL AND duplicate_profile.primary_identifier IS NOT NULL) THEN
          better_duplicate_id := duplicate_profile.id;
          EXIT; -- Found a better one, use it
        END IF;
      END LOOP;
      
      -- If we found a better duplicate, swap canonical and duplicate
      IF better_duplicate_id IS NOT NULL THEN
        -- Remove the better duplicate from duplicates array and add canonical to it
        duplicate_ids := array_remove(duplicate_ids, better_duplicate_id);
        duplicate_ids := array_append(duplicate_ids, canonical_profile.id);
        
        -- Update canonical_profile to the better one
        SELECT INTO canonical_profile 
          id, name, headline, primary_identifier, secondary_identifier, enriched_at, first_seen
        FROM profiles 
        WHERE id = better_duplicate_id;
        
        RAISE NOTICE 'Swapped canonical to better profile: %', canonical_profile.id;
      END IF;
    END;
    
    -- Update reactions to point to canonical profile
    UPDATE reactions 
    SET reactor_profile_id = canonical_profile.id 
    WHERE reactor_profile_id = ANY(duplicate_ids);
    
    -- Update comments to point to canonical profile
    UPDATE comments 
    SET commenter_profile_id = canonical_profile.id 
    WHERE commenter_profile_id = ANY(duplicate_ids);
    
    -- Merge any missing identifier data from duplicates to canonical
    FOR i IN 1..array_length(duplicate_ids, 1) LOOP
      DECLARE
        duplicate_data RECORD;
      BEGIN
        SELECT INTO duplicate_data 
          primary_identifier, secondary_identifier, profile_pictures, urn
        FROM profiles 
        WHERE id = duplicate_ids[i];
        
        -- Update canonical with any missing identifiers
        UPDATE profiles SET
          primary_identifier = COALESCE(primary_identifier, duplicate_data.primary_identifier),
          secondary_identifier = COALESCE(secondary_identifier, duplicate_data.secondary_identifier),
          profile_pictures = COALESCE(
            CASE WHEN profile_pictures IS NOT NULL AND profile_pictures != 'null'::jsonb 
            THEN profile_pictures ELSE NULL END,
            CASE WHEN duplicate_data.profile_pictures IS NOT NULL AND duplicate_data.profile_pictures != 'null'::jsonb 
            THEN duplicate_data.profile_pictures ELSE NULL END
          ),
          last_updated = NOW()
        WHERE id = canonical_profile.id;
      END;
    END LOOP;
    
    -- Delete duplicate profiles
    DELETE FROM profiles WHERE id = ANY(duplicate_ids);
    
    RAISE NOTICE 'Merged % duplicates for name+headline: "%" / "%" (kept profile: %)', 
      array_length(duplicate_ids, 1), 
      duplicate_group.name,
      duplicate_group.headline,
      canonical_profile.id;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Execute the name+headline merge function
SELECT merge_duplicates_by_name_headline();

-- Drop the temporary function
DROP FUNCTION merge_duplicates_by_name_headline();

-- Verify results - check for remaining name+headline duplicates
DO $$
DECLARE
  duplicate_count INTEGER;
  remaining_duplicate RECORD;
BEGIN
  -- Check for remaining duplicates by name+headline
  SELECT COUNT(*) INTO duplicate_count
  FROM (
    SELECT name, headline, COUNT(*) as cnt
    FROM profiles 
    WHERE name IS NOT NULL 
      AND headline IS NOT NULL
      AND trim(name) != ''
      AND trim(headline) != ''
    GROUP BY name, headline
    HAVING COUNT(*) > 1
  ) duplicates;
  
  IF duplicate_count > 0 THEN
    RAISE NOTICE 'WARNING: % name+headline duplicates still exist', duplicate_count;
    
    -- Show the remaining duplicates for manual review
    FOR remaining_duplicate IN
      SELECT name, headline, COUNT(*) as cnt, array_agg(id) as profile_ids
      FROM profiles 
      WHERE name IS NOT NULL AND headline IS NOT NULL
      GROUP BY name, headline
      HAVING COUNT(*) > 1
      LIMIT 5
    LOOP
      RAISE NOTICE 'Remaining duplicate: "%" / "%" (% profiles: %)', 
        remaining_duplicate.name, remaining_duplicate.headline, remaining_duplicate.cnt, remaining_duplicate.profile_ids;
    END LOOP;
  ELSE
    RAISE NOTICE 'SUCCESS: No name+headline duplicates found';
  END IF;
END;
$$;

-- Final summary of all profile counts
DO $$
DECLARE
  total_profiles INTEGER;
  total_enriched INTEGER;
  total_with_primary_id INTEGER;
  total_with_secondary_id INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_profiles FROM profiles;
  SELECT COUNT(*) INTO total_enriched FROM profiles WHERE enriched_at IS NOT NULL;
  SELECT COUNT(*) INTO total_with_primary_id FROM profiles WHERE primary_identifier IS NOT NULL;
  SELECT COUNT(*) INTO total_with_secondary_id FROM profiles WHERE secondary_identifier IS NOT NULL;
  
  RAISE NOTICE 'DEDUPLICATION COMPLETE:';
  RAISE NOTICE 'Total profiles: %', total_profiles;
  RAISE NOTICE 'Enriched profiles: %', total_enriched;
  RAISE NOTICE 'Profiles with primary_identifier: %', total_with_primary_id;
  RAISE NOTICE 'Profiles with secondary_identifier: %', total_with_secondary_id;
END;
$$;
