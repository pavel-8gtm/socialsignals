-- Add primary and secondary identifier fields for better profile matching and deduplication
ALTER TABLE profiles ADD COLUMN primary_identifier TEXT;
ALTER TABLE profiles ADD COLUMN secondary_identifier TEXT;

-- Add index for faster lookups
CREATE INDEX idx_profiles_primary_identifier ON profiles(primary_identifier);
CREATE INDEX idx_profiles_secondary_identifier ON profiles(secondary_identifier);

-- Add comments for clarity
COMMENT ON COLUMN profiles.primary_identifier IS 'Primary LinkedIn identifier - URN (e.g., ACoAACYtTzMBogGchMxe2TLjemBgNNcX8kTeeSs)';
COMMENT ON COLUMN profiles.secondary_identifier IS 'Secondary LinkedIn identifier - public identifier/vanity URL (e.g., muhammad-sohail-98360515a)';

-- Populate existing records where possible
-- Extract URN from existing urn column
UPDATE profiles 
SET primary_identifier = urn 
WHERE urn IS NOT NULL AND primary_identifier IS NULL;

-- Extract public identifier from profile_url
UPDATE profiles 
SET secondary_identifier = REGEXP_REPLACE(profile_url, '^https?://(?:www\.)?linkedin\.com/in/([^/?]+).*$', '\1', 'i')
WHERE profile_url IS NOT NULL 
  AND secondary_identifier IS NULL 
  AND profile_url ~ '^https?://(?:www\.)?linkedin\.com/in/[^/?]+';
