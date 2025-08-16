-- Migration to fix duplicate posts and update constraint

-- First, remove duplicate posts (keep the most recent one for each post_id)
WITH duplicates AS (
  SELECT 
    id,
    post_id,
    user_id,
    created_at,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, post_id 
      ORDER BY created_at DESC
    ) as rn
  FROM posts
  WHERE post_id IS NOT NULL
)
DELETE FROM posts 
WHERE id IN (
  SELECT id FROM duplicates WHERE rn > 1
);

-- Drop the old constraint that allowed duplicates
ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_user_id_post_url_key;

-- Add new constraint to prevent duplicates by post_id instead of post_url
ALTER TABLE posts ADD CONSTRAINT posts_user_id_post_id_key 
  UNIQUE (user_id, post_id);
