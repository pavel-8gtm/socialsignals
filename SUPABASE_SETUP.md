# Supabase Setup Guide

This project has been configured with Supabase for authentication and database functionality.

## Project Structure

```
├── lib/
│   ├── supabase.ts              # Basic Supabase client (legacy)
│   ├── supabase/
│   │   ├── client.ts            # Client-side Supabase client
│   │   └── server.ts            # Server-side Supabase client
│   └── types/
│       └── database.types.ts    # TypeScript types for your database
├── middleware.ts                # Next.js middleware for auth handling
├── supabase/                    # Supabase CLI configuration
└── .env.local                   # Environment variables (not committed to git)
```

## Setup Instructions

### 1. Configure Environment Variables

Update your `.env.local` file with your actual Supabase credentials:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### 2. Get Your Supabase Credentials

You can get these from your Supabase dashboard:
- Go to https://supabase.com/dashboard
- Select your project
- Go to Settings > API
- Copy the URL and anon key

### 3. Start Local Development (Optional)

If you want to use local Supabase for development:

```bash
supabase start
```

This will start local Supabase services including PostgreSQL, Auth, and more.

### 4. Link to Your Supabase Project (Optional)

To link this local setup to your remote Supabase project:

```bash
supabase link --project-ref your-project-ref
```

## Usage Examples

### Client Component (Browser)

```tsx
'use client'
import { createClient } from '@/lib/supabase/client'

export default function ClientComponent() {
  const supabase = createClient()
  
  // Use supabase client here
}
```

### Server Component

```tsx
import { createClient } from '@/lib/supabase/server'

export default async function ServerComponent() {
  const supabase = createClient()
  
  // Use supabase client here
}
```

### API Route

```tsx
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = createClient()
  
  // Use supabase client here
}
```

## Testing the Setup

Visit `/supabase-test` to test your Supabase connection and see the current authentication status.

## Features Configured

- ✅ Supabase client for browser usage
- ✅ Supabase client for server usage  
- ✅ Authentication middleware
- ✅ TypeScript types structure
- ✅ Environment variables setup
- ✅ Local development support

## Next Steps

1. Create your database schema in Supabase dashboard or using migrations
2. Generate TypeScript types: `supabase gen types typescript --local > lib/types/database.types.ts`
3. Implement authentication flows (signup, login, logout)
4. Create your application's data models and API routes
5. Set up Row Level Security (RLS) policies for your tables
