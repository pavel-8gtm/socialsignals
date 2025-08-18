-- Add last sync time tracking to user_settings
-- This will help identify truly "new" profiles since the last scraping session

-- Add last_sync_time column to user_settings
ALTER TABLE user_settings 
ADD COLUMN last_sync_time TIMESTAMP WITH TIME ZONE;

-- Add comment to explain the column
COMMENT ON COLUMN user_settings.last_sync_time IS 'Timestamp of the last scraping session (reactions, comments, or posts). Used to identify new profiles discovered since last sync.';

-- For existing users, set last_sync_time to NULL initially
-- This means all profiles will be considered "existing" until the next sync
UPDATE user_settings 
SET last_sync_time = NULL 
WHERE last_sync_time IS NULL;

-- Create index for performance
CREATE INDEX idx_user_settings_last_sync ON user_settings(last_sync_time);
