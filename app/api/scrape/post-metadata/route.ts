import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ApifyService } from '@/lib/services/apify'
import type { Database } from '@/lib/types/database.types'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { postIds } = await request.json() as { postIds: string[] }

    if (!postIds || postIds.length === 0) {
      return NextResponse.json({ error: 'No post IDs provided' }, { status: 400 })
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

    const apifyService = new ApifyService(userSettings.apify_api_key)
    let totalProcessed = 0
    const errors: { postId: string, message: string }[] = []

    for (const postId of postIds) {
      try {
        // Get post from database with current engagement stats
        const { data: post, error: postError } = await supabase
          .from('posts')
          .select('id, post_url, num_likes, num_comments, num_shares')
          .eq('id', postId)
          .eq('user_id', user.id)
          .single()

        if (postError || !post) {
          errors.push({ postId, message: `Post not found: ${postError?.message}` })
          continue
        }

        console.log(`Scraping metadata for post: ${post.post_url}`)

        // Scrape post metadata
        const postDetail = await apifyService.scrapePostDetail(post.post_url)

        console.log('Post detail scraped:', {
          postId: postDetail.post.id,
          createdAt: postDetail.post.created_at.date,
          author: postDetail.author.name
        })

        // Check for engagement changes
        const currentLikes = post.num_likes || 0
        const currentComments = post.num_comments || 0
        const currentShares = post.num_shares || 0
        
        const newLikes = postDetail.stats.total_reactions || 0
        const newComments = postDetail.stats.comments || 0
        const newShares = postDetail.stats.shares || 0
        
        const engagementChanged = 
          newLikes !== currentLikes ||
          newComments !== currentComments ||
          newShares !== currentShares

        console.log(`Engagement check for post ${postId}:`, {
          old: { likes: currentLikes, comments: currentComments, shares: currentShares },
          new: { likes: newLikes, comments: newComments, shares: newShares },
          changed: engagementChanged
        })

        // Update post with metadata
        const updateData: any = {
          // Post metadata
          post_text: postDetail.post.text,
          post_type: postDetail.post.type,
          posted_at_iso: new Date(postDetail.post.created_at.timestamp).toISOString(),
          posted_at_timestamp: postDetail.post.created_at.timestamp,
          
          // Author metadata
          author_name: postDetail.author.name,
          author_profile_url: postDetail.author.profile_url,
          
          // Engagement stats
          num_likes: postDetail.stats.total_reactions,
          num_comments: postDetail.stats.comments,
          num_shares: postDetail.stats.shares,
          
          // Update timestamp
          scraped_at: new Date().toISOString()
        }

        // Add engagement tracking fields if engagement changed
        if (engagementChanged) {
          updateData.engagement_last_updated_at = new Date().toISOString()
          updateData.engagement_needs_scraping = true
        }

        const { error: updateError } = await supabase
          .from('posts')
          .update(updateData)
          .eq('id', postId)

        if (updateError) {
          console.error(`Failed to update post ${postId}:`, updateError)
          errors.push({ postId, message: `Failed to update post: ${updateError.message}` })
          continue
        }

        totalProcessed++
        console.log(`Successfully updated post ${postId} with metadata`)

      } catch (error: any) {
        console.error(`Error processing post ${postId}:`, error)
        errors.push({ postId, message: error.message || 'Unknown error' })
      }
    }

    return NextResponse.json({
      message: 'Post metadata scraping completed',
      totalProcessed,
      errors
    })

  } catch (error) {
    console.error('Post metadata scraping error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
