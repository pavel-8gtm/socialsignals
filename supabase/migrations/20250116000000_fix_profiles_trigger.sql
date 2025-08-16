-- Fix the profiles table trigger to use the correct column name
-- The profiles table uses 'last_updated' but the generic trigger function tries to set 'updated_at'

-- Drop the existing trigger
DROP TRIGGER IF EXISTS update_profiles_last_updated ON profiles;

-- Create a specific function for profiles table
CREATE OR REPLACE FUNCTION update_profiles_last_updated_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.last_updated = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create the correct trigger for profiles table
CREATE TRIGGER update_profiles_last_updated 
    BEFORE UPDATE ON profiles 
    FOR EACH ROW EXECUTE FUNCTION update_profiles_last_updated_column();
