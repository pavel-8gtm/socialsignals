import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ApifyService, type ApifyCommentData } from '@/lib/services/apify'
import type { Database } from '@/lib/types/database.types'

type Profile = Database['public']['Tables']['profiles']['Insert']
type Comment = Database['public']['Tables']['comments']['Insert']

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

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

    // Create scrape job record
    const { data: scrapeJob, error: jobError } = await supabase
      .from('scrape_jobs')
      .insert({
        user_id: user.id,
        job_type: 'comments',
        status: 'running',
        post_ids: postIds,
        started_at: new Date().toISOString()
      })
      .select()
      .single()

    if (jobError) {
      return NextResponse.json({ error: 'Failed to create scrape job' }, { status: 500 })
    }

    // Initialize Apify service
    const apifyService = new ApifyService(userSettings.apify_api_key)
    
    let totalScraped = 0
    const errors: string[] = []

    try {
      console.log(`Scraping comments for ${posts.length} posts`)
      
      // Get post URLs for the Apify scraper
      const postUrls = posts.map(post => post.post_url)
      
      // Scrape all comments for these posts
      const comments = await apifyService.scrapeAllPostComments(postUrls)
      
      console.log(`Found ${comments.length} comments for posts`)
      
      if (comments.length > 0) {
        // Process and store comments by grouping them by post
        const commentsByPost = new Map<string, ApifyCommentData[]>()
        
        comments.forEach(comment => {
          const postUrl = comment.post_input
          if (!commentsByPost.has(postUrl)) {
            commentsByPost.set(postUrl, [])
          }
          commentsByPost.get(postUrl)!.push(comment)
        })
        
        // Process each post's comments
        for (const post of posts) {
          const postComments = commentsByPost.get(post.post_url) || []
          
          if (postComments.length > 0) {
            const processedCount = await processComments(supabase, postComments, post, user.id)
            totalScraped += processedCount || 0
          }

          // Update post's last_comments_scrape timestamp
          await supabase
            .from('posts')
            .update({ last_comments_scrape: new Date().toISOString() })
            .eq('id', post.id)
        }
      }

    } catch (error) {
      const errorMessage = `Failed to scrape comments: ${error instanceof Error ? error.message : 'Unknown error'}`
      console.error(errorMessage)
      errors.push(errorMessage)
    }

    // Update scrape job
    await supabase
      .from('scrape_jobs')
      .update({
        status: errors.length > 0 ? 'failed' : 'completed',
        completed_at: new Date().toISOString(),
        total_items_scraped: totalScraped,
        error_message: errors.length > 0 ? errors.join('; ') : null
      })
      .eq('id', scrapeJob.id)

    return NextResponse.json({
      success: true,
      totalScraped,
      postsProcessed: posts.length,
      errors: errors.length > 0 ? errors : undefined,
      scrapeJobId: scrapeJob.id
    })

  } catch (error) {
    console.error('Scrape comments error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

async function processComments(
  supabase: Awaited<ReturnType<typeof createClient>>,
  comments: ApifyCommentData[],
  post: Database['public']['Tables']['posts']['Row'],
  userId: string
) {
  // Filter out comments with invalid data
  const validComments = comments.filter(comment => {
    const hasValidAuthor = comment.author?.name && comment.author?.profile_url
    const hasValidId = comment.comment_id && typeof comment.comment_id === 'string'
    
    if (!hasValidAuthor || !hasValidId) {
      console.warn('Skipping comment with invalid data:', comment)
      return false
    }
    return true
  })

  console.log(`Processing ${validComments.length} valid comments out of ${comments.length} total`)

  if (validComments.length === 0) {
    console.log('No valid comments to process')
    return 0
  }

  // First, process all unique profiles
  const uniqueProfiles = new Map<string, ApifyCommentData['author']>()
  
  validComments.forEach(comment => {
    // Use profile_url as the unique identifier since we don't have URN
    if (!uniqueProfiles.has(comment.author.profile_url)) {
      uniqueProfiles.set(comment.author.profile_url, comment.author)
    }
  })

  // Upsert profiles - we'll use profile_url as URN since comments scraper doesn't provide URN
  const profilesToUpsert: Profile[] = Array.from(uniqueProfiles.values()).map(author => ({
    urn: author.profile_url, // Using profile_url as URN for comments-based profiles
    name: author.name,
    headline: author.headline,
    profile_url: author.profile_url,
    profile_pictures: author.profile_picture ? {
      original: author.profile_picture,
      large: author.profile_picture,
      medium: author.profile_picture,
      small: author.profile_picture
    } : null
  }))

  if (profilesToUpsert.length > 0) {
    const { error: profilesError } = await supabase
      .from('profiles')
      .upsert(profilesToUpsert, {
        onConflict: 'urn',
        ignoreDuplicates: false
      })

    if (profilesError) {
      throw new Error(`Failed to upsert profiles: ${profilesError.message}`)
    }
  }

  // Get profile IDs for the comments
  const { data: profilesWithIds, error: profilesSelectError } = await supabase
    .from('profiles')
    .select('id, urn')
    .in('urn', Array.from(uniqueProfiles.keys()))

  if (profilesSelectError) {
    throw new Error(`Failed to get profile IDs: ${profilesSelectError.message}`)
  }

  // Create a map of URN (profile_url) to profile ID
  const urnToIdMap = new Map<string, string>()
  profilesWithIds.forEach((profile: { urn: string; id: string }) => {
    urnToIdMap.set(profile.urn, profile.id)
  })

  // Prepare comments for insertion
  const commentsToInsert: Comment[] = validComments.map(comment => {
    const profileId = urnToIdMap.get(comment.author.profile_url)
    if (!profileId) {
      throw new Error(`Profile ID not found for profile URL: ${comment.author.profile_url}`)
    }

    return {
      user_id: userId,
      post_id: post.id,
      commenter_profile_id: profileId,
      comment_id: comment.comment_id,
      comment_text: comment.text,
      comment_url: comment.comment_url,
      posted_at_timestamp: comment.posted_at.timestamp,
      posted_at_date: new Date(comment.posted_at.timestamp).toISOString(),
      is_edited: comment.is_edited,
      is_pinned: comment.is_pinned,
      total_reactions: comment.stats.total_reactions,
      reactions_breakdown: comment.stats.reactions,
      replies_count: comment.stats.comments,
      scraped_at: new Date().toISOString(),
      page_number: comment._metadata?.page_number || 1
    }
  })

  // Insert comments with upsert to handle duplicates
  if (commentsToInsert.length > 0) {
    const { error: commentsError } = await supabase
      .from('comments')
      .upsert(commentsToInsert, {
        onConflict: 'post_id,comment_id',
        ignoreDuplicates: true
      })

    if (commentsError) {
      throw new Error(`Failed to insert comments: ${commentsError.message}`)
    }
  }

  return validComments.length
}
