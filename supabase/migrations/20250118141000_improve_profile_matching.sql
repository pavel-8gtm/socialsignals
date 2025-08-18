-- Improve profile matching for future scraping operations
-- Add a function to help match profiles by name when URN-based matching fails

-- Create a function to find existing profile by name when URN doesn't match
CREATE OR REPLACE FUNCTION find_existing_profile_by_name(
    p_name TEXT,
    p_urn TEXT
) RETURNS UUID AS $$
DECLARE
    existing_profile_id UUID;
BEGIN
    -- First try exact URN match (current behavior)
    SELECT id INTO existing_profile_id
    FROM profiles 
    WHERE urn = p_urn
    LIMIT 1;
    
    IF existing_profile_id IS NOT NULL THEN
        RETURN existing_profile_id;
    END IF;
    
    -- If no URN match, try name-based matching as fallback
    -- Only match if the name is reasonably unique (longer than 10 chars to avoid false positives)
    IF LENGTH(TRIM(p_name)) > 10 THEN
        SELECT id INTO existing_profile_id
        FROM profiles 
        WHERE LOWER(TRIM(name)) = LOWER(TRIM(p_name))
        LIMIT 1;
        
        IF existing_profile_id IS NOT NULL THEN
            -- Log this fallback match for debugging
            RAISE NOTICE 'Fallback name-based match found for %: existing profile % matched new URN %', 
                p_name, existing_profile_id, p_urn;
            RETURN existing_profile_id;
        END IF;
    END IF;
    
    -- No match found
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Add a comment explaining the function
COMMENT ON FUNCTION find_existing_profile_by_name(TEXT, TEXT) IS 
'Helper function to find existing profiles by name when URN-based matching fails due to LinkedIn URL inconsistencies (vanity URL vs internal ID).';

-- Create an index on lowercase name for better performance of name-based lookups
CREATE INDEX IF NOT EXISTS idx_profiles_name_lower ON profiles (LOWER(TRIM(name)));

COMMENT ON INDEX idx_profiles_name_lower IS 'Index for case-insensitive name lookups in profile matching.';
