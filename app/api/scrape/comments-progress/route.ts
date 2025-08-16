import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ApifyService, type ApifyCommentData } from '@/lib/services/apify'
import type { Database } from '@/lib/types/database.types'

type Profile = Database['public']['Tables']['profiles']['Insert']
type Comment = Database['public']['Tables']['comments']['Insert']

// Store progress data in memory
const progressStore = new Map<string, {
  status: 'starting' | 'scraping' | 'processing' | 'saving' | 'completed' | 'error'
  progress: number
  currentStep: string
  totalPosts?: number
  processedPosts?: number
  totalComments?: number
  processedComments?: number
  error?: string
  result?: any
}>()

export async function POST(request: NextRequest) {
  const progressId = Math.random().toString(36).substring(7)
  
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

    // Initialize progress tracking
    progressStore.set(progressId, {
      status: 'starting',
      progress: 0,
      currentStep: 'Initializing comments scraper...',
      totalPosts: posts.length,
      processedPosts: 0
    })

    // Start the scraping process asynchronously
    processCommentsScraping(progressId, posts, user, userSettings.apify_api_key)

    return NextResponse.json({ progressId })

  } catch (error) {
    console.error('Error starting comments scraping:', error)
    progressStore.set(progressId, {
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

  const progress = progressStore.get(progressId)
  if (!progress) {
    return NextResponse.json({ error: 'Progress not found' }, { status: 404 })
  }

  // Clean up completed/error entries after they're retrieved
  if (progress.status === 'completed' || progress.status === 'error') {
    setTimeout(() => progressStore.delete(progressId), 30000)
  }

  return NextResponse.json(progress)
}

async function processCommentsScraping(
  progressId: string,
  posts: any[],
  user: any,
  apifyApiKey: string
) {
  const supabase = await createClient()
  
  try {
    // Update progress: Starting scraper
    progressStore.set(progressId, {
      status: 'scraping',
      progress: 10,
      currentStep: 'Starting Apify comments scraper...',
      totalPosts: posts.length,
      processedPosts: 0
    })

    // Initialize Apify service
    const apifyService = new ApifyService(apifyApiKey)

    // Batch process posts using the existing scrapeAllPostComments method
    const postUrls = posts.map(p => p.post_url)
    
    progressStore.set(progressId, {
      status: 'scraping',
      progress: 20,
      currentStep: `Starting batch scraping for ${posts.length} posts... (check Apify console for run details)`,
      totalPosts: posts.length,
      processedPosts: 0
    })

    console.log(`Scraping comments for ${posts.length} posts`)
    
    // Update: Apify batch run in progress
    progressStore.set(progressId, {
      status: 'scraping',
      progress: 25,
      currentStep: `Apify batch run in progress for ${posts.length} posts... (this may take several minutes)`,
      totalPosts: posts.length,
      processedPosts: 0
    })
    
    const allCommentsData = await apifyService.scrapeAllPostComments(postUrls)
    console.log(`Found ${allCommentsData.length} total comments across all posts`)
    
    // Update: Batch scraping completed
    progressStore.set(progressId, {
      status: 'processing',
      progress: 45,
      currentStep: `Batch scraping completed! Found ${allCommentsData.length} comments total. Processing...`,
      totalPosts: posts.length,
      processedPosts: 0,
      totalComments: allCommentsData.length
    })

    // Update progress: Processing comments
    progressStore.set(progressId, {
      status: 'processing',
      progress: 50,
      currentStep: `Processing ${allCommentsData.length} comments...`,
      totalPosts: posts.length,
      processedPosts: 0,
      totalComments: allCommentsData.length,
      processedComments: 0
    })

    // Group comments by post URL
    const commentsByPostUrl = new Map<string, ApifyCommentData[]>()
    allCommentsData.forEach(comment => {
      const postUrl = comment.post_input // Fix: use correct field name from ApifyCommentData
      if (!commentsByPostUrl.has(postUrl)) {
        commentsByPostUrl.set(postUrl, [])
      }
      commentsByPostUrl.get(postUrl)!.push(comment)
    })

    const results: any[] = []
    const errors: string[] = []

    // Process each post
    for (let i = 0; i < posts.length; i++) {
      const post = posts[i]
      const postProgress = 50 + (i / posts.length) * 40 // 50-90%

      try {
        progressStore.set(progressId, {
          status: 'processing',
          progress: postProgress,
          currentStep: `Processing post ${i + 1} of ${posts.length}...`,
          totalPosts: posts.length,
          processedPosts: i,
          totalComments: allCommentsData.length,
          processedComments: results.reduce((sum, r) => sum + r.commentsCount, 0)
        })

        const postComments = commentsByPostUrl.get(post.post_url) || []
        console.log(`Processing ${postComments.length} comments for post ${post.id}`)
        
        // Update: Found comments for this post
        progressStore.set(progressId, {
          status: 'processing',
          progress: postProgress + 1,
          currentStep: `Found ${postComments.length} comments for post ${i + 1} of ${posts.length}. Saving...`,
          totalPosts: posts.length,
          processedPosts: i,
          totalComments: allCommentsData.length,
          processedComments: results.reduce((sum, r) => sum + r.commentsCount, 0)
        })

        if (postComments.length > 0) {
          // Filter out comments with invalid data (same as regular API)
          const validComments = postComments.filter(comment => {
            const hasValidAuthor = comment.author?.name && comment.author?.profile_url
            const hasValidId = comment.comment_id && typeof comment.comment_id === 'string'
            
            if (!hasValidAuthor || !hasValidId) {
              console.warn('Skipping comment with invalid data:', comment)
              return false
            }
            return true
          })

          console.log(`Processing ${validComments.length} valid comments out of ${postComments.length} total`)

          if (validComments.length === 0) {
            console.log('No valid comments to process')
            results.push({
              postId: post.id,
              postUrl: post.post_url,
              commentsCount: 0,
              profilesCount: 0
            })
          } else {
            // Process profiles first (same approach as regular API)
            const uniqueProfiles = new Map<string, any>()
            
            validComments.forEach(comment => {
              // Use profile_url as the unique identifier since we don't have URN (same as regular API)
              if (!uniqueProfiles.has(comment.author.profile_url)) {
                uniqueProfiles.set(comment.author.profile_url, comment.author)
              }
            })

            // Upsert profiles - we'll use profile_url as URN since comments scraper doesn't provide URN (same as regular API)
            const profilesToUpsert = Array.from(uniqueProfiles.values()).map(author => ({
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
              const { error: profileError } = await supabase
                .from('profiles')
                .upsert(profilesToUpsert, {
                  onConflict: 'urn',
                  ignoreDuplicates: false
                })

              if (profileError) {
                console.error('Error upserting profiles:', profileError)
                errors.push(`Failed to save profiles for post ${post.id}: ${profileError.message}`)
              }
            }

            // Get profile IDs for the comments (same as regular API)
            const { data: profilesWithIds, error: profilesSelectError } = await supabase
              .from('profiles')
              .select('id, urn')
              .in('urn', Array.from(uniqueProfiles.keys()))

            if (profilesSelectError) {
              console.error('Failed to get profile IDs:', profilesSelectError)
              errors.push(`Failed to get profile IDs for post ${post.id}: ${profilesSelectError.message}`)
            } else {
              // Create a map of URN to profile ID
              const urnToIdMap = new Map<string, string>()
              profilesWithIds?.forEach((profile: { urn: string; id: string }) => {
                urnToIdMap.set(profile.urn, profile.id)
              })

              // Prepare comments for insertion
              const comments: Comment[] = validComments.map(comment => {
                const profileId = urnToIdMap.get(comment.author.profile_url)
                if (!profileId) {
                  throw new Error(`Profile ID not found for profile URL: ${comment.author.profile_url}`)
                }

                return {
                  user_id: user.id,
                  post_id: post.id,
                  commenter_profile_id: profileId,
                  comment_id: comment.comment_id,
                  comment_text: comment.text,
                  comment_url: comment.comment_url,
                  posted_at_timestamp: comment.posted_at?.timestamp,
                  posted_at_date: comment.posted_at?.timestamp ? new Date(comment.posted_at.timestamp).toISOString() : null,
                  is_edited: comment.is_edited,
                  is_pinned: comment.is_pinned,
                  total_reactions: comment.stats?.total_reactions,
                  reactions_breakdown: comment.stats?.reactions,
                  replies_count: comment.stats?.comments,
                  scraped_at: new Date().toISOString(),
                  page_number: comment._metadata?.page_number || 1
                }
              })

              // Delete existing comments for this post
              const { error: deleteError } = await supabase
                .from('comments')
                .delete()
                .eq('user_id', user.id)
                .eq('post_id', post.id)

              if (deleteError) {
                console.error('Error deleting existing comments:', deleteError)
                errors.push(`Failed to delete existing comments for post ${post.id}: ${deleteError.message}`)
              }

              // Insert new comments
              const { error: insertError } = await supabase
                .from('comments')
                .insert(comments)

              if (insertError) {
                console.error('Error inserting comments:', insertError)
                errors.push(`Failed to insert comments for post ${post.id}: ${insertError.message}`)
              }

              results.push({
                postId: post.id,
                postUrl: post.post_url,
                commentsCount: validComments.length,
                profilesCount: uniqueProfiles.size
              })
            }
          }

        } else {
          // No comments found
          results.push({
            postId: post.id,
            postUrl: post.post_url,
            commentsCount: 0,
            profilesCount: 0
          })
        }

        // Update progress: Post completed
        progressStore.set(progressId, {
          status: 'processing',
          progress: postProgress + 3,
          currentStep: `Completed post ${i + 1} of ${posts.length} (${results[results.length - 1].commentsCount} comments found)`,
          totalPosts: posts.length,
          processedPosts: i + 1,
          totalComments: allCommentsData.length,
          processedComments: results.reduce((sum, r) => sum + r.commentsCount, 0)
        })

        // Update post with scrape info
        const { error: updateError } = await supabase
          .from('posts')
          .update({
            last_comments_scrape: new Date().toISOString(),
            engagement_needs_scraping: false,
            engagement_last_updated_at: new Date().toISOString()
          })
          .eq('id', post.id)

        if (updateError) {
          console.error('Error updating post:', updateError)
          errors.push(`Failed to update post ${post.id}: ${updateError.message}`)
        }

      } catch (error) {
        console.error(`Error processing comments for post ${post.id}:`, error)
        errors.push(`Failed to process post ${post.id}: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }

    // Final progress update
    const totalComments = results.reduce((sum, result) => sum + result.commentsCount, 0)
    const totalProfiles = results.reduce((sum, result) => sum + result.profilesCount, 0)
    
    let message = `Successfully scraped comments for ${posts.length} posts`
    if (totalComments > 0) {
      message += ` • Found ${totalComments} comments from ${totalProfiles} unique profiles`
    } else {
      message += ' • No comments found'
    }

    if (errors.length > 0) {
      message += ` • ${errors.length} errors occurred`
    }

    progressStore.set(progressId, {
      status: 'completed',
      progress: 100,
      currentStep: 'Completed successfully',
      totalPosts: posts.length,
      processedPosts: posts.length,
      totalComments,
      processedComments: totalComments,
      result: {
        message,
        postsProcessed: posts.length,
        totalComments,
        totalProfiles,
        results,
        errors
      }
    })

    console.log(`Comments scraping completed for ${posts.length} posts`)

  } catch (error) {
    console.error('Error in comments scraping:', error)
    progressStore.set(progressId, {
      status: 'error',
      progress: 0,
      currentStep: 'Error occurred',
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    })
  }
}
