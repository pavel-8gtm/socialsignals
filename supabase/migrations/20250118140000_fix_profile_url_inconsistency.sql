-- Fix profile URL inconsistency for LinkedIn profiles
-- Some profiles have vanity URLs (username) while others have internal IDs (ACoAAAxxxxx)
-- Both can refer to the same person but our URN extraction treats them as different

DO $$
DECLARE
    duplicate_group RECORD;
    keeper_profile RECORD;
    duplicate_profile RECORD;
    reaction_count INTEGER;
    comment_count INTEGER;
BEGIN
    -- Process each group of duplicate names where we have different URN formats
    FOR duplicate_group IN
        SELECT name, COUNT(*) as profile_count
        FROM profiles
        WHERE name IS NOT NULL AND trim(name) != ''
        GROUP BY name
        HAVING COUNT(*) > 1
    LOOP
        RAISE NOTICE 'Processing potential URL inconsistency group: % (% profiles)', duplicate_group.name, duplicate_group.profile_count;

        -- Get the oldest profile as the keeper (prefer internal ID format if available)
        SELECT id, urn, name, first_seen, profile_url
        INTO keeper_profile
        FROM profiles
        WHERE name = duplicate_group.name
        ORDER BY 
            -- Prefer internal ID format (ACoAAA...) over vanity URLs
            CASE WHEN urn LIKE 'ACoAAA%' THEN 0 ELSE 1 END,
            first_seen ASC
        LIMIT 1;

        RAISE NOTICE 'Keeper profile: % - % (first_seen: %, urn_type: %)', 
            keeper_profile.name, 
            keeper_profile.urn, 
            keeper_profile.first_seen,
            CASE WHEN keeper_profile.urn LIKE 'ACoAAA%' THEN 'internal_id' ELSE 'vanity_url' END;

        -- Process all other profiles with the same name (duplicates to merge)
        FOR duplicate_profile IN
            SELECT id, urn, name, first_seen, profile_url
            FROM profiles
            WHERE name = duplicate_group.name
            AND id != keeper_profile.id
            ORDER BY first_seen ASC
        LOOP
            RAISE NOTICE 'Merging duplicate: % - % (first_seen: %, urn_type: %)', 
                duplicate_profile.name, 
                duplicate_profile.urn, 
                duplicate_profile.first_seen,
                CASE WHEN duplicate_profile.urn LIKE 'ACoAAA%' THEN 'internal_id' ELSE 'vanity_url' END;

            -- Update reactions to point to keeper profile
            UPDATE reactions
            SET reactor_profile_id = keeper_profile.id
            WHERE reactor_profile_id = duplicate_profile.id;

            GET DIAGNOSTICS reaction_count = ROW_COUNT;
            RAISE NOTICE 'Updated % reactions for %', reaction_count, duplicate_profile.name;

            -- Update comments to point to keeper profile
            UPDATE comments
            SET commenter_profile_id = keeper_profile.id
            WHERE commenter_profile_id = duplicate_profile.id;

            GET DIAGNOSTICS comment_count = ROW_COUNT;
            RAISE NOTICE 'Updated % comments for %', comment_count, duplicate_profile.name;

            -- Delete the duplicate profile
            DELETE FROM profiles WHERE id = duplicate_profile.id;

            RAISE NOTICE 'Deleted duplicate profile: % (id: %)', duplicate_profile.name, duplicate_profile.id;
        END LOOP;
    END LOOP;

    RAISE NOTICE 'Profile URL inconsistency merge completed successfully!';
END $$;

-- Add a comment explaining the issue
COMMENT ON MIGRATION '20250118140000_fix_profile_url_inconsistency' IS 
'Fix duplicate profiles caused by LinkedIn profile URL inconsistency. LinkedIn provides both vanity URLs (username) and internal ID URLs for the same person, which our URN extraction treats as different entities.';
