import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ApifyService, type ApifyProfilePostData } from '@/lib/services/apify'
import type { Database } from '@/lib/types/database.types'

type Post = Database['public']['Tables']['posts']['Insert']

export async function POST(request: NextRequest) {
  try {
    const { profileUrl, scrapeUntilDate, maxPosts } = await request.json()

    if (!profileUrl) {
      return NextResponse.json({ error: 'Profile URL is required' }, { status: 400 })
    }

    const supabase = await createClient()

    // Get authenticated user
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
        error: 'Apify API key not found. Please add your API key in settings.' 
      }, { status: 400 })
    }

    console.log(`Scraping posts from profile: ${profileUrl}`)
    console.log(`Scrape until date: ${scrapeUntilDate || 'No limit'}`)
    console.log(`Max posts: ${maxPosts || 'No limit'}`)

    // Initialize Apify service
    const apifyService = new ApifyService(userSettings.apify_api_key)

    // Scrape posts from the profile
    const profilePosts = await apifyService.scrapeProfilePosts({
      profileUrl,
      scrapeUntilDate,
      maxPosts
    })

    console.log(`Scraped ${profilePosts.length} posts from profile`)

    if (profilePosts.length === 0) {
      return NextResponse.json({ 
        message: 'No posts found for this profile',
        totalProcessed: 0,
        errors: []
      })
    }

    // Transform posts for database insertion (based on instructions.md format)
    const postsToInsert: Post[] = profilePosts.map(postData => {
      // Extract post ID from URL like "7361594677537513472" from "activity-7361594677537513472"
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

    // Check which posts already exist and get their current engagement stats
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

    // Detect engagement changes and mark posts that need scraping
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

    // Insert posts using upsert to handle duplicates by post_id (not URL)
    const { data: insertedPosts, error: insertError } = await supabase
      .from('posts')
      .upsert(postsWithEngagementChanges, {
        onConflict: 'user_id,post_id',
        ignoreDuplicates: false
      })
      .select('id, post_url')

    if (insertError) {
      console.error('Failed to insert posts:', insertError)
      return NextResponse.json({ 
        error: `Failed to save posts: ${insertError.message}` 
      }, { status: 500 })
    }

    const totalProcessed = insertedPosts?.length || 0
    const newPosts = postsWithEngagementChanges.filter(p => p.post_id && !existingPostIds.has(p.post_id)).length
    const updatedPosts = totalProcessed - newPosts
    const postsWithEngagementUpdates = postsWithEngagementChanges.filter(p => p.engagement_needs_scraping).length
    
    console.log(`Successfully processed ${totalProcessed} posts (${newPosts} new, ${updatedPosts} updated, ${postsWithEngagementUpdates} with engagement changes)`)

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

    return NextResponse.json({
      message,
      totalProcessed,
      newPosts,
      updatedPosts,
      postsWithEngagementUpdates,
      profileUrl,
      scrapeUntilDate,
      maxPosts,
      errors: []
    })

  } catch (error) {
    console.error('Error in profile posts scraping:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Unknown error occurred' 
    }, { status: 500 })
  }
}
