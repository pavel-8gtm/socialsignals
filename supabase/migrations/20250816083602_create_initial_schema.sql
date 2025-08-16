-- =============================================================================
-- SocialSignals Database Schema
-- =============================================================================
-- This migration creates all the tables needed for the SocialSignals application
-- following the technical requirements document specifications.

-- =============================================================================
-- 1. USER_SETTINGS TABLE
-- =============================================================================
-- Purpose: Store user-specific Apify credentials
CREATE TABLE user_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    apify_api_key TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id)
);

-- Enable RLS
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

-- Create policy: users can only access their own settings
CREATE POLICY "Users can only access their own settings" ON user_settings
    FOR ALL USING (auth.uid() = user_id);

-- =============================================================================
-- 2. PROFILES TABLE  
-- =============================================================================
-- Purpose: Store information about people who reacted/commented (shared across users)
-- Note: NO RLS enabled - profiles are shared across users
CREATE TABLE profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    urn TEXT UNIQUE NOT NULL, -- from scraper: "ACoAAAIPgp0BE5gu3pTOjiQX3_uLLxgcDE0__5g"
    name TEXT,
    headline TEXT,
    profile_url TEXT,
    profile_pictures JSONB, -- store all sizes: small, medium, large, original
    first_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index on urn for performance
CREATE INDEX idx_profiles_urn ON profiles(urn);

-- =============================================================================
-- 3. POSTS TABLE
-- =============================================================================
-- Purpose: Store LinkedIn posts to be analyzed
CREATE TABLE posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    post_url TEXT NOT NULL, -- full LinkedIn post URL
    post_id TEXT, -- extracted LinkedIn post ID like "7302346926123798528"
    post_urn TEXT, -- from scraper: "urn:li:activity:7361594677537513472"
    author_name TEXT, -- from scraper: "Constantine Yurevich"
    author_profile_url TEXT, -- from scraper
    author_profile_id TEXT, -- from scraper: "yurevichcv"
    post_text TEXT, -- post content from scraper
    post_type TEXT, -- from scraper: 'text', 'article'
    num_likes INTEGER DEFAULT 0, -- from scraper numLikes
    num_comments INTEGER DEFAULT 0, -- from scraper numComments
    num_shares INTEGER DEFAULT 0, -- from scraper numShares
    posted_at_timestamp BIGINT, -- from scraper postedAtTimestamp
    posted_at_iso TIMESTAMP WITH TIME ZONE, -- from scraper postedAtISO
    scraped_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(), -- when post was added
    last_reactions_scrape TIMESTAMP WITH TIME ZONE,
    last_comments_scrape TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, post_url) -- for upsert - same post can't be added twice by same user
);

-- Enable RLS
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

-- Create policy: users can only access their own posts
CREATE POLICY "Users can only access their own posts" ON posts
    FOR ALL USING (auth.uid() = user_id);

-- Create indexes for performance
CREATE INDEX idx_posts_user_id ON posts(user_id);
CREATE INDEX idx_posts_post_id ON posts(post_id);
CREATE INDEX idx_posts_posted_at ON posts(posted_at_iso);

-- =============================================================================
-- 4. REACTIONS TABLE
-- =============================================================================
-- Purpose: Store individual reactions from Apify reactions scraper
CREATE TABLE reactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    reactor_profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    reaction_type TEXT NOT NULL, -- from scraper: 'INTEREST', 'LIKE', 'APPRECIATION', etc.
    scraped_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    page_number INTEGER, -- from pagination
    UNIQUE(post_id, reactor_profile_id, reaction_type) -- prevent duplicate reactions
);

-- Enable RLS
ALTER TABLE reactions ENABLE ROW LEVEL SECURITY;

-- Create policy: users can only access reactions for their own posts
CREATE POLICY "Users can only access reactions for their own posts" ON reactions
    FOR ALL USING (
        auth.uid() = user_id OR 
        EXISTS (SELECT 1 FROM posts WHERE posts.id = reactions.post_id AND posts.user_id = auth.uid())
    );

-- Create indexes for performance
CREATE INDEX idx_reactions_user_id ON reactions(user_id);
CREATE INDEX idx_reactions_post_id ON reactions(post_id);
CREATE INDEX idx_reactions_profile_id ON reactions(reactor_profile_id);

-- =============================================================================
-- 5. COMMENTS TABLE
-- =============================================================================
-- Purpose: Store comments from Apify "Linkedin Post Comments,Replies,Engagements Scraper | No Cookies"
CREATE TABLE comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    commenter_profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    comment_id TEXT UNIQUE NOT NULL, -- from scraper: "7337832757777096704"
    comment_text TEXT,
    comment_url TEXT,
    posted_at_timestamp BIGINT, -- from scraper
    posted_at_date TIMESTAMP WITH TIME ZONE, -- from scraper
    is_edited BOOLEAN DEFAULT FALSE,
    is_pinned BOOLEAN DEFAULT FALSE,
    total_reactions INTEGER DEFAULT 0, -- from scraper stats
    reactions_breakdown JSONB, -- from scraper stats.reactions
    replies_count INTEGER DEFAULT 0, -- from scraper stats.comments
    scraped_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    page_number INTEGER, -- from pagination
    UNIQUE(post_id, comment_id) -- comments are globally unique by LinkedIn's comment_id
);

-- Enable RLS
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

-- Create policy: users can only access comments for their own posts
CREATE POLICY "Users can only access comments for their own posts" ON comments
    FOR ALL USING (
        auth.uid() = user_id OR 
        EXISTS (SELECT 1 FROM posts WHERE posts.id = comments.post_id AND posts.user_id = auth.uid())
    );

-- Create indexes for performance
CREATE INDEX idx_comments_user_id ON comments(user_id);
CREATE INDEX idx_comments_post_id ON comments(post_id);
CREATE INDEX idx_comments_profile_id ON comments(commenter_profile_id);
CREATE INDEX idx_comments_comment_id ON comments(comment_id);

-- =============================================================================
-- 6. SCRAPE_JOBS TABLE
-- =============================================================================
-- Purpose: Track scraping operations status
CREATE TABLE scrape_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    job_type TEXT NOT NULL CHECK (job_type IN ('reactions', 'comments', 'posts')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    post_ids TEXT[], -- array of post IDs being scraped
    apify_run_id TEXT, -- for tracking
    total_items_scraped INTEGER DEFAULT 0,
    error_message TEXT,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE scrape_jobs ENABLE ROW LEVEL SECURITY;

-- Create policy: users can only access their own scrape jobs
CREATE POLICY "Users can only access their own scrape jobs" ON scrape_jobs
    FOR ALL USING (auth.uid() = user_id);

-- Create indexes for performance
CREATE INDEX idx_scrape_jobs_user_id ON scrape_jobs(user_id);
CREATE INDEX idx_scrape_jobs_status ON scrape_jobs(status);
CREATE INDEX idx_scrape_jobs_type ON scrape_jobs(job_type);

-- =============================================================================
-- TRIGGERS FOR UPDATED_AT COLUMNS
-- =============================================================================

-- Create a generic function to update the updated_at column
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for tables that have updated_at columns
CREATE TRIGGER update_user_settings_updated_at 
    BEFORE UPDATE ON user_settings 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_posts_updated_at 
    BEFORE UPDATE ON posts 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_profiles_last_updated 
    BEFORE UPDATE ON profiles 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
