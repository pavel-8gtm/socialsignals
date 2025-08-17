import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ApifyService, type ApifyReactionData } from '@/lib/services/apify'
import type { Database } from '@/lib/types/database.types'

type Profile = Database['public']['Tables']['profiles']['Insert']
type Reaction = Database['public']['Tables']['reactions']['Insert']

// Store progress data in memory
const progressStore = new Map<string, {
  status: 'starting' | 'scraping' | 'processing' | 'saving' | 'completed' | 'error'
  progress: number
  currentStep: string
  totalPosts?: number
  processedPosts?: number
  totalReactions?: number
  processedReactions?: number
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
      currentStep: 'Initializing reactions scraper...',
      totalPosts: posts.length,
      processedPosts: 0
    })

    // Start the scraping process asynchronously
    processReactionsScraping(progressId, posts, user, userSettings.apify_api_key)

    return NextResponse.json({ progressId })

  } catch (error) {
    console.error('Error starting reactions scraping:', error)
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

async function processReactionsScraping(
  progressId: string,
  posts: any[],
  user: any,
  apifyApiKey: string
) {
  const supabase = await createClient()
  
  try {
    const results: any[] = []
    const errors: string[] = []

    // Update progress: Starting scraper
    progressStore.set(progressId, {
      status: 'scraping',
      progress: 10,
      currentStep: 'Starting reactions scraper...',
      totalPosts: posts.length,
      processedPosts: 0
    })

    // Initialize Apify service
    const apifyService = new ApifyService(apifyApiKey)
    const postUrls = posts.map(p => p.post_url)

    // Update: Starting concurrent scraping
    progressStore.set(progressId, {
      status: 'scraping',
      progress: 20,
      currentStep: `Scraping reactions from ${posts.length} posts...`,
      totalPosts: posts.length,
      processedPosts: 0
    })

    console.log(`Starting concurrent reactions scraping for ${posts.length} posts`)
    
    // Scrape all reactions concurrently (much faster!)
    const allReactionsData = await apifyService.scrapeAllPostReactionsConcurrent(postUrls, 32)
    console.log(`Found ${allReactionsData.length} total reactions across all posts`)

    // Update: Concurrent scraping completed, now processing results
    progressStore.set(progressId, {
      status: 'processing',
      progress: 60,
      currentStep: `Found ${allReactionsData.length} reactions. Processing results...`,
      totalPosts: posts.length,
      processedPosts: 0,
      totalReactions: allReactionsData.length
    })

    // Group reactions by post URL
    const reactionsByPostUrl = new Map<string, ApifyReactionData[]>()
    allReactionsData.forEach(reaction => {
      const postUrl = reaction._metadata?.post_url
      if (postUrl) {
        if (!reactionsByPostUrl.has(postUrl)) {
          reactionsByPostUrl.set(postUrl, [])
        }
        reactionsByPostUrl.get(postUrl)!.push(reaction)
      }
    })

    // Process each post's results
    for (let i = 0; i < posts.length; i++) {
      const post = posts[i]
      const baseProgress = 60 + (i / posts.length) * 30 // 60-90%

      try {
        // Update progress: Processing this post
        progressStore.set(progressId, {
          status: 'processing',
          progress: baseProgress,
          currentStep: `Processing post ${i + 1} of ${posts.length}...`,
          totalPosts: posts.length,
          processedPosts: i,
          totalReactions: allReactionsData.length
        })

        const reactionsData = reactionsByPostUrl.get(post.post_url) || []
        console.log(`Processing ${reactionsData.length} reactions for post ${post.id}`)

        // Update: Processing results
        progressStore.set(progressId, {
          status: 'processing',
          progress: baseProgress + 5,
          currentStep: `Saving ${reactionsData.length} reactions for post ${i + 1} of ${posts.length}...`,
          totalPosts: posts.length,
          processedPosts: i,
          totalReactions: results.reduce((sum, r) => sum + r.reactionsCount, 0) + reactionsData.length
        })

        if (reactionsData.length > 0) {

          // Filter out reactions with invalid/null URNs (same as regular API)
          const validReactions = reactionsData.filter(reaction => {
            const urn = reaction.reactor?.urn
            if (!urn || typeof urn !== 'string' || urn.trim() === '') {
              console.warn('Skipping reaction with invalid URN:', reaction)
              return false
            }
            return true
          })

          console.log(`Processing ${validReactions.length} valid reactions out of ${reactionsData.length} total`)

          if (validReactions.length === 0) {
            console.log('No valid reactions to process')
            results.push({
              postId: post.id,
              postUrl: post.post_url,
              reactionsCount: 0,
              profilesCount: 0
            })
          } else {
            // Process profiles first (same approach as regular API)
            const uniqueProfiles = new Map<string, any>()
            
            validReactions.forEach(reaction => {
              if (!uniqueProfiles.has(reaction.reactor.urn)) {
                uniqueProfiles.set(reaction.reactor.urn, reaction.reactor)
              }
            })

            // Upsert profiles using URN as key (same as regular API)
            const profilesToUpsert = Array.from(uniqueProfiles.values()).map(reactor => ({
              urn: reactor.urn,
              name: reactor.name,
              headline: reactor.headline,
              profile_url: reactor.profile_url,
              profile_pictures: reactor.profile_pictures
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

            // Get profile IDs for the reactions (same as regular API)
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
              profilesWithIds?.forEach((profile: any) => {
                urnToIdMap.set(profile.urn, profile.id)
              })

              // Prepare reactions for insertion
              const reactions: Reaction[] = validReactions.map(reaction => {
                const profileId = urnToIdMap.get(reaction.reactor.urn)
                if (!profileId) {
                  throw new Error(`Profile ID not found for URN: ${reaction.reactor.urn}`)
                }

                return {
                  user_id: user.id,
                  post_id: post.id,
                  reactor_profile_id: profileId,
                  reaction_type: reaction.reaction_type,
                  scraped_at: new Date().toISOString(),
                  page_number: reaction._metadata?.page_number || 1
                }
              })

              // Delete existing reactions for this post
              const { error: deleteError } = await supabase
                .from('reactions')
                .delete()
                .eq('user_id', user.id)
                .eq('post_id', post.id)

              if (deleteError) {
                console.error('Error deleting existing reactions:', deleteError)
                errors.push(`Failed to delete existing reactions for post ${post.id}: ${deleteError.message}`)
              }

              // Insert reactions
              const { error: insertError } = await supabase
                .from('reactions')
                .insert(reactions)

              if (insertError) {
                console.error('Error inserting reactions:', insertError)
                errors.push(`Failed to insert reactions for post ${post.id}: ${insertError.message}`)
              }

              results.push({
                postId: post.id,
                postUrl: post.post_url,
                reactionsCount: validReactions.length,
                profilesCount: uniqueProfiles.size
              })
            }
          }

        } else {
          // No reactions found
          results.push({
            postId: post.id,
            postUrl: post.post_url,
            reactionsCount: 0,
            profilesCount: 0
          })
        }

        // Update post with scrape info (regardless of whether reactions were found)
        const { error: updateError } = await supabase
          .from('posts')
          .update({
            last_reactions_scrape: new Date().toISOString(),
            engagement_needs_scraping: false,
            engagement_last_updated_at: new Date().toISOString()
          })
          .eq('id', post.id)

        if (updateError) {
          console.error('Error updating post:', updateError)
          errors.push(`Failed to update post ${post.id}: ${updateError.message}`)
        }

        // Update progress: Post completed
        progressStore.set(progressId, {
          status: 'scraping',
          progress: baseProgress + 8,
          currentStep: `Completed post ${i + 1} of ${posts.length} (${results[results.length - 1].reactionsCount} reactions found)`,
          totalPosts: posts.length,
          processedPosts: i + 1,
          totalReactions: results.reduce((sum, r) => sum + r.reactionsCount, 0)
        })

      } catch (error) {
        console.error(`Error scraping reactions for post ${post.id}:`, error)
        errors.push(`Failed to scrape post ${post.id}: ${error instanceof Error ? error.message : 'Unknown error'}`)
        
        // Update progress: Error occurred for this post
        progressStore.set(progressId, {
          status: 'scraping',
          progress: baseProgress + 8,
          currentStep: `Error on post ${i + 1} of ${posts.length}: ${error instanceof Error ? error.message : 'Unknown error'}`,
          totalPosts: posts.length,
          processedPosts: i + 1,
          totalReactions: results.reduce((sum, r) => sum + r.reactionsCount, 0)
        })
      }
    }

    // Final progress update
    const totalReactions = results.reduce((sum, result) => sum + result.reactionsCount, 0)
    const totalProfiles = results.reduce((sum, result) => sum + result.profilesCount, 0)
    
    let message = `Successfully scraped reactions for ${posts.length} posts`
    if (totalReactions > 0) {
      message += ` • Found ${totalReactions} reactions from ${totalProfiles} unique profiles`
    } else {
      message += ' • No reactions found'
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
      totalReactions,
      processedReactions: totalReactions,
      result: {
        message,
        postsProcessed: posts.length,
        totalReactions,
        totalProfiles,
        results,
        errors
      }
    })

    console.log(`Reactions scraping completed for ${posts.length} posts`)

  } catch (error) {
    console.error('Error in reactions scraping:', error)
    progressStore.set(progressId, {
      status: 'error',
      progress: 0,
      currentStep: 'Error occurred',
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    })
  }
}
