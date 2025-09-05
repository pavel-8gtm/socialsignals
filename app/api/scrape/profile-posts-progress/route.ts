import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ApifyService } from '@/lib/services/apify'
import type { Database } from '@/lib/types/database.types'

type Post = Database['public']['Tables']['posts']['Insert']

interface ProgressData {
  status: 'starting' | 'scraping' | 'processing' | 'saving' | 'completed' | 'error'
  progress: number
  currentStep: string
  totalPosts?: number
  processedPosts?: number
  error?: string
  result?: Record<string, unknown>
}

interface UserData {
  id: string
}

// Helper functions for database progress tracking
async function saveProgress(supabase: Awaited<ReturnType<typeof createClient>>, progressId: string, userId: string, data: ProgressData) {
  const { error } = await supabase
    .from('api_progress')
    .upsert({
      id: progressId,
      user_id: userId,
      status: data.status,
      progress: data.progress,
      current_step: data.currentStep,
      total_posts: data.totalPosts,
      processed_posts: data.processedPosts,
      error_message: data.error,
      result: data.result,
      updated_at: new Date().toISOString()
    })
  
  if (error) {
    console.error('Failed to save progress:', error)
  }
}

async function getProgress(supabase: Awaited<ReturnType<typeof createClient>>, progressId: string): Promise<ProgressData | null> {
  const { data, error } = await supabase
    .from('api_progress')
    .select('*')
    .eq('id', progressId)
    .single()
  
  if (error || !data) {
    return null
  }
  
  return {
    status: data.status,
    progress: data.progress,
    currentStep: data.current_step,
    totalPosts: data.total_posts,
    processedPosts: data.processed_posts,
    error: data.error_message,
    result: data.result
  }
}

export async function POST(request: NextRequest) {
  const progressId = Math.random().toString(36).substring(7)
  const supabase = await createClient()

  // Get authenticated user
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  
  try {
    const { profileUrl, scrapeUntilDate, maxPosts } = await request.json()

    if (!profileUrl) {
      return NextResponse.json({ error: 'Profile URL is required' }, { status: 400 })
    }

    // Get user's Apify API key
    const { data: userSettings, error: settingsError } = await supabase
      .from('user_settings')
      .select('apify_api_key')
      .eq('user_id', user.id)
      .single()

    if (settingsError || !userSettings?.apify_api_key) {
      return NextResponse.json({ 
        error: 'Apify API key not found. Please add your API key in settings.' 
      }, { status: 400 })
    }

    // Initialize progress tracking
    await saveProgress(supabase, progressId, user.id, {
      status: 'starting',
      progress: 0,
      currentStep: 'Initializing scraper...'
    })

    // Start the scraping process asynchronously
    processProfileScraping(progressId, profileUrl, user, userSettings.apify_api_key, supabase, scrapeUntilDate, maxPosts)

    return NextResponse.json({ progressId })

  } catch (error) {
    console.error('Error starting profile posts scraping:', error)
    await saveProgress(supabase, progressId, user.id, {
      status: 'error',
      progress: 0,
      currentStep: 'Failed to start',
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    })
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Unknown error occurred' 
    }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const progressId = searchParams.get('progressId')

  if (!progressId) {
    return NextResponse.json({ error: 'Progress ID is required' }, { status: 400 })
  }

  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const progress = await getProgress(supabase, progressId)
    if (!progress) {
      return NextResponse.json({ error: 'Progress not found' }, { status: 404 })
    }

    // Clean up completed/error entries after they're retrieved
    if (progress.status === 'completed' || progress.status === 'error') {
      setTimeout(async () => {
        await supabase.from('api_progress').delete().eq('id', progressId)
      }, 30000)
    }

    return NextResponse.json(progress)
  } catch (error) {
    console.error('Error retrieving progress:', error)
    return NextResponse.json({ error: 'Failed to retrieve progress' }, { status: 500 })
  }
}

async function processProfileScraping(
  progressId: string,
  profileUrl: string,
  user: UserData,
  apifyApiKey: string,
  supabase: Awaited<ReturnType<typeof createClient>>,
  scrapeUntilDate?: string,
  maxPosts?: string
) {
  
  try {
    // Update progress: Starting scraper
    await saveProgress(supabase, progressId, user.id, {
      status: 'scraping',
      progress: 10,
      currentStep: 'Starting profile scraper...'
    })

    console.log(`Scraping posts from profile: ${profileUrl}`)
    
    // Initialize Apify service
    const apifyService = new ApifyService(apifyApiKey)

    // Update progress: Scraping
    await saveProgress(supabase, progressId, user.id, {
      status: 'scraping',
      progress: 20,
      currentStep: `Scraping posts from LinkedIn profile...`
    })

    // Scrape posts from the profile
    const profilePosts = await apifyService.scrapeProfilePosts({
      profileUrl,
      scrapeUntilDate,
      maxPosts: maxPosts ? parseInt(maxPosts, 10) : undefined
    })

    console.log(`Scraped ${profilePosts.length} posts from profile`)

    if (profilePosts.length === 0) {
      await saveProgress(supabase, progressId, user.id, {
        status: 'completed',
        progress: 100,
        currentStep: 'No posts found',
        totalPosts: 0,
        processedPosts: 0,
        result: {
          message: 'No posts found for this profile',
          totalProcessed: 0,
          errors: []
        }
      })
      return
    }

    // Update progress: Processing posts
    await saveProgress(supabase, progressId, user.id, {
      status: 'processing',
      progress: 40,
      currentStep: `Processing ${profilePosts.length} posts...`,
      totalPosts: profilePosts.length,
      processedPosts: 0
    })

    // Transform posts for database insertion
    const postsToInsert: Post[] = profilePosts.map((postData, index) => {

      // Extract post ID from URL
      const postIdMatch = postData.url.match(/activity-(\d+)/)
      const postId = postIdMatch ? postIdMatch[1] : null

      return {
        user_id: user.id,
        post_url: postData.url,
        post_id: postId,
        post_urn: postData.urn,
        author_name: postData.authorName,
        author_profile_url: postData.authorProfileUrl,
        author_profile_id: postData.authorProfileId,
        post_text: postData.text,
        post_type: postData.type,
        num_likes: postData.numLikes,
        num_comments: postData.numComments,
        num_shares: postData.numShares,
        posted_at_timestamp: postData.postedAtTimestamp,
        posted_at_iso: postData.postedAtISO,
        scraped_at: new Date().toISOString()
      }
    })

    // Update progress: Checking existing posts
    await saveProgress(supabase, progressId, user.id, {
      status: 'processing',
      progress: 70,
      currentStep: 'Checking for existing posts...',
      totalPosts: profilePosts.length,
      processedPosts: profilePosts.length
    })

    // Check which posts already exist
    const existingPostIds = new Set()
    const existingPostsMap = new Map()
    if (postsToInsert.length > 0) {
      const { data: existingPosts } = await supabase
        .from('posts')
        .select('post_id, num_likes, num_comments, num_shares')
        .eq('user_id', user.id)
        .in('post_id', postsToInsert.map(p => p.post_id).filter(id => id !== null))
      
      existingPosts?.forEach(p => {
        existingPostIds.add(p.post_id)
        existingPostsMap.set(p.post_id, {
          num_likes: p.num_likes || 0,
          num_comments: p.num_comments || 0,
          num_shares: p.num_shares || 0
        })
      })
    }

    // Update progress: Detecting engagement changes
    await saveProgress(supabase, progressId, user.id, {
      status: 'processing',
      progress: 80,
      currentStep: 'Detecting engagement changes...',
      totalPosts: profilePosts.length,
      processedPosts: profilePosts.length
    })

    // Detect engagement changes
    const postsWithEngagementChanges = postsToInsert.map(post => {
      const existing = existingPostsMap.get(post.post_id)
      let engagementChanged = false
      
      if (existing) {
        engagementChanged = 
          (post.num_likes || 0) !== existing.num_likes ||
          (post.num_comments || 0) !== existing.num_comments ||
          (post.num_shares || 0) !== existing.num_shares
      }
      
      return {
        ...post,
        engagement_last_updated_at: engagementChanged ? new Date().toISOString() : undefined,
        engagement_needs_scraping: engagementChanged
      }
    })

    // Update progress: Saving to database
    await saveProgress(supabase, progressId, user.id, {
      status: 'saving',
      progress: 90,
      currentStep: 'Saving posts to database...',
      totalPosts: profilePosts.length,
      processedPosts: profilePosts.length
    })

    // Insert posts using upsert
    const { data: insertedPosts, error: insertError } = await supabase
      .from('posts')
      .upsert(postsWithEngagementChanges, {
        onConflict: 'user_id,post_id',
        ignoreDuplicates: false
      })
      .select('id, post_url')

    if (insertError) {
      throw new Error(`Failed to save posts: ${insertError.message}`)
    }

    const totalProcessed = insertedPosts?.length || 0
    const newPosts = postsWithEngagementChanges.filter(p => p.post_id && !existingPostIds.has(p.post_id)).length
    const updatedPosts = totalProcessed - newPosts
    const postsWithEngagementUpdates = postsWithEngagementChanges.filter(p => p.engagement_needs_scraping).length
    
    let message = `Successfully processed ${totalProcessed} posts from profile`
    if (newPosts > 0 && updatedPosts > 0) {
      message += ` (${newPosts} new, ${updatedPosts} updated)`
    } else if (newPosts > 0) {
      message += ` (${newPosts} new)`
    } else if (updatedPosts > 0) {
      message += ` (${updatedPosts} updated existing)`
    }
    
    if (postsWithEngagementUpdates > 0) {
      message += ` • ${postsWithEngagementUpdates} posts have new engagement and need re-scraping`
    }

    // Final progress update
    await saveProgress(supabase, progressId, user.id, {
      status: 'completed',
      progress: 100,
      currentStep: 'Completed successfully',
      totalPosts: profilePosts.length,
      processedPosts: profilePosts.length,
      result: {
        message,
        totalProcessed,
        newPosts,
        updatedPosts,
        postsWithEngagementUpdates,
        profileUrl,
        scrapeUntilDate,
        maxPosts,
        errors: []
      }
    })

    console.log(`Successfully processed ${totalProcessed} posts`)

  } catch (error) {
    console.error('Error in profile posts scraping:', error)
    await saveProgress(supabase, progressId, user.id, {
      status: 'error',
      progress: 0,
      currentStep: 'Error occurred',
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    })
  }
}
