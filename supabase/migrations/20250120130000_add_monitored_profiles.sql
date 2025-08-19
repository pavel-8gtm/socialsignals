-- Add monitored_profiles field to user_settings table
ALTER TABLE user_settings ADD COLUMN monitored_profiles TEXT[];

-- Add comment for clarity
COMMENT ON COLUMN user_settings.monitored_profiles IS 'Array of LinkedIn profile URLs that the user wants to monitor for regular scraping';

-- Set default to empty array for existing records
UPDATE user_settings SET monitored_profiles = '{}' WHERE monitored_profiles IS NULL;
