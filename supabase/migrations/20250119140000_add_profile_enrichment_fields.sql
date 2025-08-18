-- Add enriched profile data fields
-- These fields will be populated by the LinkedIn Profile Enrichment Apify actor

ALTER TABLE profiles 
ADD COLUMN first_name TEXT,
ADD COLUMN last_name TEXT,
ADD COLUMN profile_picture_url TEXT,
ADD COLUMN country TEXT,
ADD COLUMN city TEXT,
ADD COLUMN current_title TEXT,
ADD COLUMN current_company TEXT,
ADD COLUMN is_current_position BOOLEAN DEFAULT false,
ADD COLUMN company_linkedin_url TEXT,
ADD COLUMN public_identifier TEXT,
ADD COLUMN enriched_at TIMESTAMP WITH TIME ZONE;

-- Add index for public_identifier for efficient lookups during unification
CREATE INDEX idx_profiles_public_identifier ON profiles(public_identifier) WHERE public_identifier IS NOT NULL;

-- Add index for enriched_at to track enrichment status
CREATE INDEX idx_profiles_enriched_at ON profiles(enriched_at) WHERE enriched_at IS NOT NULL;

-- Add comments for documentation
COMMENT ON COLUMN profiles.first_name IS 'First name extracted from LinkedIn enrichment';
COMMENT ON COLUMN profiles.last_name IS 'Last name extracted from LinkedIn enrichment';
COMMENT ON COLUMN profiles.profile_picture_url IS 'Profile picture URL from LinkedIn';
COMMENT ON COLUMN profiles.country IS 'Country from LinkedIn location data';
COMMENT ON COLUMN profiles.city IS 'City from LinkedIn location data';
COMMENT ON COLUMN profiles.current_title IS 'Current job title from most recent experience';
COMMENT ON COLUMN profiles.current_company IS 'Current company name from most recent experience';
COMMENT ON COLUMN profiles.is_current_position IS 'Whether the current_title/company represents an active position';
COMMENT ON COLUMN profiles.company_linkedin_url IS 'LinkedIn URL of the current company';
COMMENT ON COLUMN profiles.public_identifier IS 'LinkedIn public identifier (vanity URL part) for profile unification';
COMMENT ON COLUMN profiles.enriched_at IS 'Timestamp when profile was last enriched via LinkedIn Profile Enrichment actor';
