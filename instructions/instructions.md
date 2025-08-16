# SocialSignals - Technical Product Requirements Document

## Project Overview

**Project Name:** SocialSignals  
**Technology Stack:** Next.js 15, Shadcn UI, Supabase (Auth + Database), Apify API  
**Objective:** Web application for scraping and analyzing LinkedIn post engagement data (reactions, comments) with multi-user support

## 1. Database Schema (Supabase)

### user_settings Table
**Purpose:** Store user-specific Apify credentials
**Fields:**
- id (UUID, primary key)
- user_id (UUID, foreign key to auth.users)
- apify_api_key (TEXT, encrypted)
- created_at (TIMESTAMP)
- updated_at (TIMESTAMP)
- Unique constraint on user_id
- RLS enabled (users can only access their own settings)

### posts Table
**Purpose:** Store LinkedIn posts to be analyzed
**Fields:**
- id (UUID, primary key)
- user_id (UUID, foreign key to auth.users)
- post_url (TEXT, full LinkedIn post URL)
- post_id (TEXT, extracted LinkedIn post ID like "7302346926123798528")
- post_urn (TEXT, from scraper: "urn:li:activity:7361594677537513472")
- author_name (TEXT, from scraper: "Constantine Yurevich")
- author_profile_url (TEXT, from scraper)
- author_profile_id (TEXT, from scraper: "yurevichcv")
- post_text (TEXT, post content from scraper)
- post_type (TEXT, from scraper: 'text', 'article')
- num_likes (INTEGER, from scraper numLikes)
- num_comments (INTEGER, from scraper numComments)
- num_shares (INTEGER, from scraper numShares)
- posted_at_timestamp (BIGINT, from scraper postedAtTimestamp)
- posted_at_iso (TIMESTAMP, from scraper postedAtISO)
- scraped_at (TIMESTAMP, when post was added)
- last_reactions_scrape (TIMESTAMP)
- last_comments_scrape (TIMESTAMP)
- created_at (TIMESTAMP)
- updated_at (TIMESTAMP)
- Unique constraint on (user_id, post_url) for upsert
- RLS enabled

### profiles Table
**Purpose:** Store information about people who reacted/commented (shared across users)
**Fields:**
- id (UUID, primary key)
- urn (TEXT, unique, from scraper: "ACoAAAIPgp0BE5gu3pTOjiQX3_uLLxgcDE0__5g")
- name (TEXT, from scraper)
- headline (TEXT, from scraper)
- profile_url (TEXT, from scraper)
- profile_pictures (JSONB, store all sizes from scraper: small, medium, large, original)
- first_seen (TIMESTAMP)
- last_updated (TIMESTAMP)
- Unique constraint on urn

### reactions Table
**Purpose:** Store individual reactions from Apify reactions scraper
**Fields:**
- id (UUID, primary key)
- user_id (UUID, foreign key to auth.users)
- post_id (UUID, foreign key to posts)
- reactor_profile_id (UUID, foreign key to profiles)
- reaction_type (TEXT, from scraper: 'INTEREST', 'LIKE', 'APPRECIATION', etc.)
- scraped_at (TIMESTAMP)
- page_number (INTEGER, from pagination)
- Unique constraint on (post_id, reactor_profile_id, reaction_type)
- RLS enabled

### comments Table
**Purpose:** Store comments from Apify "Linkedin Post Comments,Replies,Engagements Scraper | No Cookies"
**Fields:**
- id (UUID, primary key)
- user_id (UUID, foreign key to auth.users)
- post_id (UUID, foreign key to posts)
- commenter_profile_id (UUID, foreign key to profiles)
- comment_id (TEXT, from scraper: "7337832757777096704")
- comment_text (TEXT, from scraper)
- comment_url (TEXT, from scraper)
- posted_at_timestamp (BIGINT, from scraper)
- posted_at_date (TIMESTAMP, from scraper)
- is_edited (BOOLEAN, from scraper)
- is_pinned (BOOLEAN, from scraper)
- total_reactions (INTEGER, from scraper stats)
- reactions_breakdown (JSONB, from scraper stats.reactions)
- replies_count (INTEGER, from scraper stats.comments)
- scraped_at (TIMESTAMP)
- page_number (INTEGER, from pagination)
- Unique constraint on (post_id, comment_id)
- RLS enabled

### scrape_jobs Table
**Purpose:** Track scraping operations status
**Fields:**
- id (UUID, primary key)
- user_id (UUID, foreign key to auth.users)
- job_type (TEXT: 'reactions', 'comments', 'posts')
- status (TEXT: 'pending', 'running', 'completed', 'failed')
- post_ids (TEXT[], array of post IDs being scraped)
- apify_run_id (TEXT, for tracking)
- total_items_scraped (INTEGER)
- error_message (TEXT)
- started_at (TIMESTAMP)
- completed_at (TIMESTAMP)
- created_at (TIMESTAMP)
- RLS enabled

## 2. Implementation Steps

### Step 1: Set up basic tables with schemas in Supabase
- Create all tables as specified above
- Set up Row Level Security policies
- Configure foreign key relationships
- Add necessary indexes

### Step 2: Create authentication flow to sign up and login as a new user
- Implement Supabase Auth integration
- Create signup page with email/password
- Create login page with email/password
- Add user session management
- Create settings page for Apify API key storage

### Step 3: Possibility to add a new post into 'posts' table manually
- Create form accepting LinkedIn post URL or post ID
- Parse URL formats: "https://www.linkedin.com/posts/satyanadella_activity-7302346926123798528" or "7302346926123798528"
- Extract post_id from URL using regex
- Store in posts table with user_id
- Use upsert to handle duplicates

### Step 4: Possibility to see all posts from table in UI
- Create posts listing page
- Display posts in table format with columns:
  - Post URL (clickable)
  - Author name
  - Post date
  - Reactions count
  - Comments count
  - Last scraped (reactions/comments)
- Add pagination for large datasets
- Show when last scrape was done for each post

### Step 5: Possibility to click button to scrape post reactions
- Add "Scrape Reactions" button for individual posts
- Add bulk "Scrape Reactions" for selected posts
- Call Apify "LinkedIn Post Reactions Scraper" with post_url
- Handle pagination (page_number 1, 2, 3, etc.) until all reactions scraped
- Process response and store in reactions table
- Upsert reactor profiles into profiles table
- Update post's last_reactions_scrape timestamp
- Show progress/status during scraping

### Step 6: Possibility to click button to scrape post comments
- Add "Scrape Comments" button for individual posts
- Add bulk "Scrape Comments" for selected posts
- Call Apify "Linkedin Post Comments,Replies,Engagements Scraper | No Cookies" with postIds array
- Handle pagination (page_number 1, 2, 3, etc.) until all comments scraped
- Process response and store in comments table
- Upsert commenter profiles into profiles table
- Update post's last_comments_scrape timestamp
- Show progress/status during scraping

### Step 7: Possibility to scrape more posts automatically from specific LinkedIn user
- Create form accepting LinkedIn profile URL: "https://www.linkedin.com/in/yurevichcv/"
- Call Apify "LinkedIn Post Scraper" with parameters:
  - deepScrape: true
  - limitPerSource: 200
  - rawData: true
  - scrapeUntil: specified date
  - urls: array with profile URL
- Process response array and upsert posts into posts table
- Extract and store all post metadata from scraper response
- Show count of new posts discovered

## 3. Core Features

### Posts Management
- Manual post addition via URL or ID
- Automated post discovery from LinkedIn profiles
- Posts listing with engagement metrics
- Duplicate prevention using upsert operations

### Scraping Operations
- Individual and bulk reactions scraping
- Individual and bulk comments scraping
- Automatic pagination handling (100 items per page limit)
- Real-time scraping status updates
- Last scrape timestamp tracking

### Analytics Dashboard
- Table showing all persons who reacted/commented
- Statistics: how many posts they reacted to or commented on
- Clickable profiles showing detailed engagement popup
- Filter and sort capabilities
- Show changes since last scrape

### Profile Detail View
- Popup showing person's engagement details
- List all posts they engaged with
- Show engagement type (reaction/comment)
- Display profile information (name, headline, picture)

## 4. UI Components Required

### Authentication Pages
- Login form with email/password
- Signup form with email/password
- Settings page for Apify API key

### Posts Management Pages
- Posts listing table with action buttons
- Add post form (URL/ID input)
- Profile scraping form
- Scraping progress indicators

### Analytics Pages
- Profiles engagement table
- Profile detail popup/modal
- Statistics dashboard
- Change tracking display

## 5. Apify Integration Specifications

### Reactions Scraper Input Format
```
{
    "post_url": "https://www.linkedin.com/posts/satyanadella_activity-7302346926123798528",
    "page_number": 1
}
```

### Post Scraper Input Format
```
{
    "deepScrape": true,
    "limitPerSource": 200,
    "rawData": true,
    "scrapeUntil": "2025-08-01",
    "urls": ["https://www.linkedin.com/in/yurevichcv/"]
}
```

### Comments Scraper Input Format
```
{
    "postIds": ["https://www.linkedin.com/posts/yurevichcv_activity-7321446486167244800"],
    "page_number": 1
}
```

### Apify Output Examples

**Reactions Scraper Output:**
```
[
  {
    "reaction_type": "INTEREST",
    "reactor": {
      "urn": "ACoAAAIPgp0BE5gu3pTOjiQX3_uLLxgcDE0__5g",
      "name": "Rhea Fox",
      "headline": "Digital Director | Marketing and Customer Strategy",
      "profile_url": "https://www.linkedin.com/in/ACoAAAIPgp0BE5gu3pTOjiQX3_uLLxgcDE0__5g",
      "profile_pictures": {
        "small": "https://media.licdn.com/dms/image/v2/D4E03AQGAuHtWLD2DYg/profile-displayphoto-shrink_100_100/...",
        "medium": "https://media.licdn.com/dms/image/v2/D4E03AQGAuHtWLD2DYg/profile-displayphoto-shrink_200_200/...",
        "large": "https://media.licdn.com/dms/image/v2/D4E03AQGAuHtWLD2DYg/profile-displayphoto-shrink_400_400/...",
        "original": "https://media.licdn.com/dms/image/v2/D4E03AQGAuHtWLD2DYg/profile-displayphoto-shrink_800_800/..."
      }
    },
    "_metadata": {
      "post_url": "https://www.linkedin.com/posts/yurevichcv_activity-7321446486167244800",
      "page_number": 1,
      "total_reactions": 262
    }
  }
]
```

**Post Scraper Output:**
```
[
  {
    "type": "text",
    "isActivity": false,
    "urn": "urn:li:activity:7361594677537513472",
    "url": "https://www.linkedin.com/posts/yurevichcv_activity-7361594677537513472",
    "timeSincePosted": "17h",
    "shareUrn": "urn:li:share:7361594677130608640",
    "text": "Three things I can watch endlessly:\n🔥 Flames dancing\n💧 Rivers running\n📈 Fragmented Meta & Pmax campaigns tripling performance after consolidation",
    "comments": [],
    "reactions": [],
    "numShares": 0,
    "numLikes": 5,
    "numComments": 0,
    "author": {
      "firstName": "Constantine",
      "lastName": "Yurevich",
      "occupation": "Marketing Measurement Expert | Founder @ SegmentStream | Advisor to High-Growth Startups & DTC Brands",
      "id": "16355220",
      "publicId": "yurevichcv",
      "profileId": "ACoAAAD5j5QBF4iXXWSySmKTfY-TgspnXCjeM9w",
      "picture": "https://media.licdn.com/dms/image/v2/D4E03AQF7j6j2UoQxjg/profile-displayphoto-shrink_400_400/..."
    },
    "authorProfileId": "yurevichcv",
    "authorName": "Constantine Yurevich",
    "authorProfileUrl": "https://www.linkedin.com/in/yurevichcv",
    "postedAtTimestamp": 1755140942940,
    "postedAtISO": "2025-08-14T03:09:02.940Z",
    "inputUrl": "https://www.linkedin.com/in/yurevichcv/"
  }
]
```

**Comments Scraper Output:**
```
[
  {
    "comment_id": "7337832757777096704",
    "text": "Cc Jean-Philippe Grondin, CPA",
    "posted_at": {
      "timestamp": 1749475659794,
      "date": "2025-06-09 15:27:39",
      "relative": "9w"
    },
    "is_edited": false,
    "is_pinned": false,
    "comment_url": "https://www.linkedin.com/feed/update/urn:li:activity:7321446486167244800?commentUrn=...",
    "author": {
      "name": "Simon Brizard",
      "headline": "Chief Ski Officer @ Orage Outerwear. ex The North Face, Red Bull & Salomon. Marketer of all things sports.",
      "profile_url": "https://www.linkedin.com/in/simon-brizard-99963b54",
      "profile_picture": "https://media.licdn.com/dms/image/v2/D4E03AQEG2Ng9_ngCQQ/profile-displayphoto-shrink_800_800/..."
    },
    "stats": {
      "total_reactions": 0,
      "reactions": {
        "like": 0,
        "appreciation": 0,
        "empathy": 0,
        "interest": 0,
        "praise": 0
      },
      "comments": 0
    },
    "replies": [],
    "post_input": "https://www.linkedin.com/posts/yurevichcv_activity-7321446486167244800",
    "totalComments": 14
  }
]
```

## 6. Data Processing Requirements

### Profile Data Processing
- Extract reactor/commenter profile information
- Store in shared profiles table (no RLS)
- Handle profile updates on subsequent scrapes
- Maintain unique constraint on URN

### Engagement Data Processing
- Process reactions array from Apify response
- Store individual reactions with post/profile relationships
- Process comments array with full metadata
- Handle pagination to get complete datasets

### Change Tracking
- Track when last scrape occurred for each post
- Identify new reactions since last scrape
- Identify new comments since last scrape  
- Display what has changed in UI (new reactions/comments indicators)
- Maintain scraping history in scrape_jobs table

## 7. Technical Requirements

### Authentication & Authorization
- Supabase Auth for user management
- Row Level Security for data isolation
- Encrypted storage of Apify API keys
- User-specific data access only

### Database Design
- PostgreSQL with proper relationships
- Upsert operations for duplicate handling
- Indexing for performance
- Foreign key constraints for data integrity

### API Integration
- Apify API client implementation
- Error handling and retry logic
- Pagination management
- Job status tracking



## Details about table cross references:

Based on the technical requirements document, here's how the tables are mapped and connected through foreign key relationships:## Key Relationships & Joins

Here are the main ways these tables connect and the typical queries you'll need:

### 1. **User Data Isolation** (via `user_id`)
```sql
-- All user-owned data is filtered by user_id due to RLS
-- Posts, reactions, comments, and scrape_jobs all have user_id FK
```

### 2. **Post Engagement Data**
```sql
-- Get all reactions for a post
SELECT p.*, pr.name, pr.headline, r.reaction_type, r.scraped_at
FROM posts p
JOIN reactions r ON p.id = r.post_id
JOIN profiles pr ON r.reactor_profile_id = pr.id
WHERE p.user_id = $user_id AND p.id = $post_id;

-- Get all comments for a post  
SELECT p.*, pr.name, pr.headline, c.comment_text, c.posted_at_date
FROM posts p
JOIN comments c ON p.id = c.post_id
JOIN profiles pr ON c.commenter_profile_id = pr.id
WHERE p.user_id = $user_id AND p.id = $post_id;
```

### 3. **Profile Engagement Analysis**
```sql
-- Find most active profiles across all user's posts
SELECT 
    pr.name, 
    pr.headline,
    COUNT(DISTINCT r.post_id) as posts_reacted_to,
    COUNT(DISTINCT c.post_id) as posts_commented_on,
    COUNT(r.id) as total_reactions,
    COUNT(c.id) as total_comments
FROM profiles pr
LEFT JOIN reactions r ON pr.id = r.reactor_profile_id AND r.user_id = $user_id
LEFT JOIN comments c ON pr.id = c.commenter_profile_id AND c.user_id = $user_id  
WHERE (r.id IS NOT NULL OR c.id IS NOT NULL)
GROUP BY pr.id, pr.name, pr.headline
ORDER BY (COUNT(r.id) + COUNT(c.id)) DESC;
```

### 4. **Post Performance Summary**
```sql
-- Get posts with engagement counts
SELECT 
    p.*,
    COUNT(DISTINCT r.id) as actual_reactions,
    COUNT(DISTINCT c.id) as actual_comments,
    p.last_reactions_scrape,
    p.last_comments_scrape
FROM posts p
LEFT JOIN reactions r ON p.id = r.post_id
LEFT JOIN comments c ON p.id = c.post_id
WHERE p.user_id = $user_id
GROUP BY p.id;
```

### 5. **Cross-Post Profile Activity**
```sql
-- See what posts a specific profile engaged with
SELECT 
    p.post_url,
    p.author_name,
    p.posted_at_iso,
    r.reaction_type,
    c.comment_text,
    c.posted_at_date as comment_date
FROM profiles pr
LEFT JOIN reactions r ON pr.id = r.reactor_profile_id AND r.user_id = $user_id
LEFT JOIN comments c ON pr.id = c.commenter_profile_id AND c.user_id = $user_id
LEFT JOIN posts p ON (r.post_id = p.id OR c.post_id = p.id)
WHERE pr.id = $profile_id AND p.id IS NOT NULL
ORDER BY COALESCE(c.posted_at_date, p.posted_at_iso) DESC;
```

## Important Design Notes:

1. **Shared Profiles Table**: The `profiles` table has no RLS since profiles are shared across users - the same LinkedIn user might engage with multiple users' posts

2. **User Isolation**: All engagement data (`reactions`, `comments`) includes `user_id` to maintain data separation even though they reference shared profiles

3. **Upsert Constraints**: 
   - `posts`: `(user_id, post_url)` - same post can't be added twice by same user
   - `reactions`: `(post_id, reactor_profile_id, reaction_type)` - same person can't have duplicate reaction types
   - `comments`: `(post_id, comment_id)` - comments are globally unique by LinkedIn's comment_id

4. **Change Tracking**: The `last_reactions_scrape` and `last_comments_scrape` timestamps on posts help identify what's new since last scrape

This structure allows you to efficiently query engagement patterns, track individual profile activity across posts, and maintain proper data isolation between users while sharing profile information.