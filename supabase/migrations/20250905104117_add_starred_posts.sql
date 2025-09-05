-- Add starred column to posts table for marking posts that need rescraping
ALTER TABLE posts ADD COLUMN starred BOOLEAN DEFAULT FALSE;

-- Add index for better performance when filtering starred posts
CREATE INDEX idx_posts_starred ON posts(starred) WHERE starred = TRUE;
