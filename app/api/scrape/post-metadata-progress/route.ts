import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ApifyService } from '@/lib/services/apify'
import type { Database } from '@/lib/types/database.types'

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
  
  // Check authentication
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  
  try {

    const body = await request.json()
    const { postIds } = body

    if (!postIds || !Array.isArray(postIds) || postIds.length === 0) {
      return NextResponse.json({ error: 'Post IDs array is required' }, { status: 400 })
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

    // Get posts to scrape
    const { data: posts, error: postsError } = await supabase
      .from('posts')
      .select('*')
      .in('id', postIds)
      .eq('user_id', user.id)

    if (postsError || !posts || posts.length === 0) {
      return NextResponse.json({ error: 'No valid posts found' }, { status: 404 })
    }

    // Initialize progress tracking in database
    await saveProgress(supabase, progressId, user.id, {
      status: 'starting',
      progress: 0,
      currentStep: 'Initializing metadata scraper...',
      totalPosts: posts.length,
      processedPosts: 0
    })

    // Start the scraping process asynchronously
    processMetadataScraping(progressId, posts, user, userSettings.apify_api_key, supabase)

    return NextResponse.json({ progressId })

  } catch (error) {
    console.error('Error starting metadata scraping:', error)
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

async function processMetadataScraping(
  progressId: string,
  posts: Database['public']['Tables']['posts']['Row'][],
  user: UserData,
  apifyApiKey: string,
  supabase: Awaited<ReturnType<typeof createClient>>
) {
  
  try {
    const results: Array<{
      postId: string
      postUrl: string
      status: string
      error?: string
    }> = []
    const errors: string[] = []

    // Update progress: Starting scraper
    await saveProgress(supabase, progressId, user.id, {
      status: 'scraping',
      progress: 10,
      currentStep: 'Starting metadata scraper...',
      totalPosts: posts.length,
      processedPosts: 0
    })

    // Initialize Apify service
    const apifyService = new ApifyService(apifyApiKey)

    // Process posts concurrently in batches
    const concurrencyLimit = 16 // Concurrent metadata fetches
    
    for (let i = 0; i < posts.length; i += concurrencyLimit) {
      const batch = posts.slice(i, i + concurrencyLimit)
      const batchProgress = (i / posts.length) * 70 + 10 // 10-80%

      await saveProgress(supabase, progressId, user.id, {
        status: 'scraping',
        progress: batchProgress,
        currentStep: `Fetching metadata for posts ${i + 1}-${Math.min(i + concurrencyLimit, posts.length)} of ${posts.length}...`,
        totalPosts: posts.length,
        processedPosts: i
      })

      // Process batch concurrently
      const batchPromises = batch.map(async (post, batchIndex) => {
        const globalIndex = i + batchIndex
        
        try {
          console.log(`Fetching metadata for post ${globalIndex + 1}/${posts.length}: ${post.post_url}`)
          
          const postDetail = await apifyService.scrapePostDetail(post.post_url)
          
          // Get current engagement stats to detect changes
          const { data: currentPost } = await supabase
            .from('posts')
            .select('num_likes, num_comments, num_shares')
            .eq('id', post.id)
            .single()

          const current = currentPost ? {
            num_likes: currentPost.num_likes || 0,
            num_comments: currentPost.num_comments || 0,
            num_shares: currentPost.num_shares || 0
          } : { num_likes: 0, num_comments: 0, num_shares: 0 }

          const newStats = {
            num_likes: postDetail.stats.total_reactions || 0,
            num_comments: postDetail.stats.comments || 0,
            num_shares: postDetail.stats.shares || 0
          }

            // Check if engagement changed
            const engagementChanged = 
              newStats.num_likes !== current.num_likes ||
              newStats.num_comments !== current.num_comments ||
              newStats.num_shares !== current.num_shares

            // Prepare update data
            const updateData: Partial<Database['public']['Tables']['posts']['Update']> = {
              post_text: postDetail.post.text,
              num_likes: newStats.num_likes,
              num_comments: newStats.num_comments,
              num_shares: newStats.num_shares,
              posted_at_timestamp: postDetail.post.created_at.timestamp,
              posted_at_iso: postDetail.post.created_at.date,
              author_name: postDetail.author.name,
              author_profile_url: postDetail.author.profile_url,
              author_profile_id: postDetail.author.profile_url, // Use profile URL as ID for now
              post_type: postDetail.post.type,
              scraped_at: new Date().toISOString(),
              metadata_last_updated_at: new Date().toISOString()
            }

            // Add engagement tracking if stats changed
            if (engagementChanged) {
              updateData.engagement_last_updated_at = new Date().toISOString()
              updateData.engagement_needs_scraping = true
            }

            // Update post in database
            const { error: updateError } = await supabase
              .from('posts')
              .update(updateData)
              .eq('id', post.id)
              .eq('user_id', user.id)

            if (updateError) {
              console.error('Error updating post metadata:', updateError)
              throw new Error(`Failed to update post ${post.id}: ${updateError.message}`)
            } else {
              return {
                postId: post.id,
                postUrl: post.post_url,
                status: 'success'
              }
            }

        } catch (error) {
          console.error(`Error fetching metadata for post ${post.id}:`, error)
          return {
            postId: post.id,
            postUrl: post.post_url,
            status: 'failed',
            engagementChanged: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          }
        }
      })

      // Wait for batch to complete
      const batchResults = await Promise.allSettled(batchPromises)
      
      // Collect results and errors
      batchResults.forEach((result, batchIndex) => {
        // const globalIndex = i + batchIndex
        
        if (result.status === 'fulfilled') {
          results.push(result.value)
        } else {
          const post = batch[batchIndex]
          console.error(`Batch promise rejected for post ${post.id}:`, result.reason)
          errors.push(`Failed to fetch metadata for post ${post.id}: ${result.reason}`)
          results.push({
            postId: post.id,
            postUrl: post.post_url,
            status: 'failed',
            error: result.reason
          })
        }

        // Note: Progress updates are handled in the batch completion
      })
    }

    // Final progress update
    const successfulUpdates = results.filter(r => r.status === 'success').length
    const failedUpdates = results.filter(r => r.status === 'failed').length
    
    let message = `Successfully fetched metadata for ${posts.length} posts`
    if (successfulUpdates > 0) {
      message += ` • ${successfulUpdates} posts updated`
    }
    if (failedUpdates > 0) {
      message += ` • ${failedUpdates} posts failed to update`
    }
    if (errors.length > 0) {
      message += ` • ${errors.length} errors occurred`
    }

    await saveProgress(supabase, progressId, user.id, {
      status: 'completed',
      progress: 100,
      currentStep: 'Completed successfully',
      totalPosts: posts.length,
      processedPosts: posts.length,
      result: {
        message,
        postsProcessed: posts.length,
        successfulUpdates,
        failedUpdates,
        results,
        errors
      }
    })

    console.log(`Metadata scraping completed for ${posts.length} posts`)

  } catch (error) {
    console.error('Error in metadata scraping:', error)
    await saveProgress(supabase, progressId, user.id, {
      status: 'error',
      progress: 0,
      currentStep: 'Error occurred',
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    })
  }
}
