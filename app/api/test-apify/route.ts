import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ApifyService } from '@/lib/services/apify'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's Apify API key
    const { data: userSettings, error: settingsError } = await supabase
      .from('user_settings')
      .select('apify_api_key')
      .eq('user_id', user.id)
      .single()

    if (settingsError || !userSettings?.apify_api_key) {
      return NextResponse.json({ 
        error: 'Apify API key not found. Please configure it in settings.' 
      }, { status: 400 })
    }

    const body = await request.json()
    const { postUrl } = body

    if (!postUrl) {
      return NextResponse.json({ error: 'Post URL is required' }, { status: 400 })
    }

    // Initialize Apify service
    const apifyService = new ApifyService(userSettings.apify_api_key)
    
    // Test scraping a single page of reactions
    const reactions = await apifyService.scrapePostReactions({
      postUrl,
      pageNumber: 1,
      limit: 5 // Just a few for testing
    })

    return NextResponse.json({
      success: true,
      postUrl,
      reactionsFound: reactions.length,
      sampleReactions: reactions.slice(0, 2), // Return first 2 as sample
      message: 'Apify integration test successful!'
    })

  } catch (error) {
    console.error('Test Apify error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error',
      success: false
    }, { status: 500 })
  }
}
