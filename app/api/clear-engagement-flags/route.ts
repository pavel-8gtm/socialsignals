import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { postIds } = await request.json()

    if (!postIds || !Array.isArray(postIds) || postIds.length === 0) {
      return NextResponse.json({ error: 'Post IDs are required' }, { status: 400 })
    }

    // Clear engagement flags for specified posts (automatically called after successful scraping)
    const { error: updateError } = await supabase
      .from('posts')
      .update({ 
        engagement_needs_scraping: false,
        engagement_last_updated_at: null 
      })
      .eq('user_id', user.id)
      .in('id', postIds)

    if (updateError) {
      console.error('Error clearing engagement flags:', updateError)
      return NextResponse.json({ 
        error: 'Failed to clear engagement flags' 
      }, { status: 500 })
    }

    return NextResponse.json({
      message: `Cleared engagement flags for ${postIds.length} posts`,
      clearedCount: postIds.length
    })

  } catch (error) {
    console.error('Error in clear engagement flags:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Unknown error occurred' 
    }, { status: 500 })
  }
}
