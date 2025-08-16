-- Clear existing reactions and profiles to re-scrape with proper LinkedIn post dates
-- This will allow re-scraping reactions with correct posted_at_iso dates

-- Delete all reactions first (due to foreign key constraints)
DELETE FROM reactions;

-- Delete all profiles (they will be re-created during re-scraping)
DELETE FROM profiles;

-- Reset scrape status on posts so they can be re-scraped
UPDATE posts SET 
  last_reactions_scrape = NULL,
  last_comments_scrape = NULL;
