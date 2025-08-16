-- Add fields to track engagement changes
ALTER TABLE posts 
ADD COLUMN engagement_last_updated_at timestamptz,
ADD COLUMN engagement_needs_scraping boolean DEFAULT false;

-- Set initial values for existing posts
UPDATE posts 
SET engagement_last_updated_at = scraped_at,
    engagement_needs_scraping = false
WHERE engagement_last_updated_at IS NULL;
