-- Add metadata_last_updated_at timestamp to track when post statistics were last fetched
-- This helps users know when likes, comments, and shares counts were last updated

-- Add the new column
ALTER TABLE posts ADD COLUMN IF NOT EXISTS metadata_last_updated_at TIMESTAMPTZ DEFAULT NULL;

-- Add index for performance when querying by metadata update date
CREATE INDEX IF NOT EXISTS idx_posts_metadata_last_updated_at ON posts(metadata_last_updated_at) WHERE metadata_last_updated_at IS NOT NULL;

-- Set default date for existing posts (August 19th 2025 at 1pm UK time)
-- UK time in August is BST (UTC+1), so 1pm UK = 12pm UTC
UPDATE posts 
SET metadata_last_updated_at = '2025-08-19 12:00:00+00:00'::TIMESTAMPTZ
WHERE metadata_last_updated_at IS NULL;

-- Add comment to document the field
COMMENT ON COLUMN posts.metadata_last_updated_at IS 'Timestamp when the post metadata (likes, comments, shares counts) was last updated via post metadata scraping';

-- Log the migration results
DO $$
DECLARE
  total_posts INTEGER;
  updated_posts INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_posts FROM posts;
  SELECT COUNT(*) INTO updated_posts FROM posts WHERE metadata_last_updated_at = '2025-08-19 12:00:00+00:00'::TIMESTAMPTZ;
  
  RAISE NOTICE 'Metadata Last Updated Timestamp Migration Complete:';
  RAISE NOTICE '- Total posts: %', total_posts;
  RAISE NOTICE '- Posts updated with default metadata date: %', updated_posts;
  RAISE NOTICE '- Default date set to: August 19th 2025, 1:00 PM UK time (12:00 UTC)';
END;
$$;
