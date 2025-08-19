-- Merge duplicate Leila Tovbina profiles
-- This handles the case where new duplicates were created after the main deduplication migrations

BEGIN;

-- Log the operation
DO $$
BEGIN
  RAISE NOTICE 'Starting merge of Leila Tovbina duplicate profiles';
  RAISE NOTICE 'Profile 1 (canonical): 9b3e5f7b-4cb2-48f3-aef0-59569a57d365 (enriched, has reactions)';
  RAISE NOTICE 'Profile 2 (duplicate): b37a718b-2385-458f-a630-ad3567a248a4 (not enriched, has comments)';
END;
$$;

-- 1. Update comments to point to the canonical profile (Profile 1)
UPDATE comments 
SET commenter_profile_id = '9b3e5f7b-4cb2-48f3-aef0-59569a57d365'
WHERE commenter_profile_id = 'b37a718b-2385-458f-a630-ad3567a248a4';

-- 2. Update reactions to point to the canonical profile (Profile 1) 
UPDATE reactions 
SET reactor_profile_id = '9b3e5f7b-4cb2-48f3-aef0-59569a57d365'
WHERE reactor_profile_id = 'b37a718b-2385-458f-a630-ad3567a248a4';

-- 3. Store the duplicate URN in alternative_urns of the canonical profile
-- Add the vanity URL 'leilatovbina' as an alternative URN
SELECT add_alternative_urn('leilatovbina', '9b3e5f7b-4cb2-48f3-aef0-59569a57d365');

-- 4. Delete the duplicate profile
DELETE FROM profiles WHERE id = 'b37a718b-2385-458f-a630-ad3567a248a4';

-- 5. Verify and log the merge results
DO $$
DECLARE
  canonical_profile RECORD;
  comments_count INTEGER;
  reactions_count INTEGER;
BEGIN
  -- Get the canonical profile info
  SELECT * INTO canonical_profile 
  FROM profiles 
  WHERE id = '9b3e5f7b-4cb2-48f3-aef0-59569a57d365';
  
  -- Count associated records
  SELECT COUNT(*) INTO comments_count 
  FROM comments 
  WHERE commenter_profile_id = '9b3e5f7b-4cb2-48f3-aef0-59569a57d365';
  
  SELECT COUNT(*) INTO reactions_count 
  FROM reactions 
  WHERE reactor_profile_id = '9b3e5f7b-4cb2-48f3-aef0-59569a57d365';
  
  RAISE NOTICE 'Merge completed successfully!';
  RAISE NOTICE 'Canonical profile: % (URN: %)', canonical_profile.name, canonical_profile.urn;
  RAISE NOTICE 'Primary identifier: %', canonical_profile.primary_identifier;
  RAISE NOTICE 'Secondary identifier: %', canonical_profile.secondary_identifier;
  RAISE NOTICE 'Alternative URNs: %', canonical_profile.alternative_urns;
  RAISE NOTICE 'Last enriched: %', canonical_profile.last_enriched_at;
  RAISE NOTICE 'Total comments: %', comments_count;
  RAISE NOTICE 'Total reactions: %', reactions_count;
END;
$$;

COMMIT;
