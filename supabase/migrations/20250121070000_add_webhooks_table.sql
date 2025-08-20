-- Create webhooks table for storing user webhook configurations
-- Users can create named webhooks for pushing profile data

CREATE TABLE webhooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL, -- User-friendly name for the webhook
    url TEXT NOT NULL, -- The webhook URL to POST data to
    description TEXT, -- Optional description
    is_active BOOLEAN DEFAULT true, -- Whether the webhook is active
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure webhook names are unique per user
    UNIQUE(user_id, name)
);

-- Enable RLS for webhooks
ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;

-- Create policy: users can only access their own webhooks
CREATE POLICY "Users can only access their own webhooks" ON webhooks
    FOR ALL USING (auth.uid() = user_id);

-- Create indexes for efficient lookups
CREATE INDEX idx_webhooks_user_id ON webhooks(user_id);
CREATE INDEX idx_webhooks_active ON webhooks(user_id, is_active) WHERE is_active = true;

-- Add comments for documentation
COMMENT ON TABLE webhooks IS 'User-defined webhook configurations for pushing profile data';
COMMENT ON COLUMN webhooks.name IS 'User-friendly name for the webhook (e.g., "CRM System", "Analytics Tool")';
COMMENT ON COLUMN webhooks.url IS 'The webhook URL where profile data will be POSTed';
COMMENT ON COLUMN webhooks.is_active IS 'Whether this webhook is active and available for use';
