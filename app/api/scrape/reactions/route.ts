import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ApifyService, type ApifyReactionData } from '@/lib/services/apify'
import type { Database } from '@/lib/types/database.types'

type Profile = Database['public']['Tables']['profiles']['Insert']
type Reaction = Database['public']['Tables']['reactions']['Insert']

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
        job_type: 'reactions',
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

    // Process each post
    for (const post of posts) {
      try {
        console.log(`Scraping reactions for post: ${post.post_id}`)
        
        // Scrape all reactions for this post
        const reactions = await apifyService.scrapeAllPostReactions(post.post_url)
        
        console.log(`Found ${reactions.length} reactions for post ${post.post_id}`)
        
        if (reactions.length > 0) {
          // Process and store reactions
          const processedCount = await processReactions(supabase, reactions, post, user.id)
          totalScraped += processedCount || 0
        }

        // Update post's last_reactions_scrape timestamp
        await supabase
          .from('posts')
          .update({ last_reactions_scrape: new Date().toISOString() })
          .eq('id', post.id)

      } catch (error) {
        const errorMessage = `Failed to scrape post ${post.post_id}: ${error instanceof Error ? error.message : 'Unknown error'}`
        console.error(errorMessage)
        errors.push(errorMessage)
      }
    }

    // Update scrape job
    await supabase
      .from('scrape_jobs')
      .update({
        status: errors.length === posts.length ? 'failed' : 'completed',
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
    console.error('Scrape reactions error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

async function processReactions(
  supabase: any,
  reactions: ApifyReactionData[],
  post: any,
  userId: string
) {
  // Filter out reactions with invalid/null URNs
  const validReactions = reactions.filter(reaction => {
    const urn = reaction.reactor?.urn
    if (!urn || typeof urn !== 'string' || urn.trim() === '') {
      console.warn('Skipping reaction with invalid URN:', reaction)
      return false
    }
    return true
  })

  console.log(`Processing ${validReactions.length} valid reactions out of ${reactions.length} total`)

  if (validReactions.length === 0) {
    console.log('No valid reactions to process')
    return
  }

  // First, process all unique profiles
  const uniqueProfiles = new Map<string, ApifyReactionData['reactor']>()
  
  validReactions.forEach(reaction => {
    if (!uniqueProfiles.has(reaction.reactor.urn)) {
      uniqueProfiles.set(reaction.reactor.urn, reaction.reactor)
    }
  })

  // Upsert profiles
  const profilesToUpsert: Profile[] = Array.from(uniqueProfiles.values()).map(reactor => ({
    urn: reactor.urn,
    name: reactor.name,
    headline: reactor.headline,
    profile_url: reactor.profile_url,
    profile_pictures: reactor.profile_pictures
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

  // Get profile IDs for the reactions
  const { data: profilesWithIds, error: profilesSelectError } = await supabase
    .from('profiles')
    .select('id, urn')
    .in('urn', Array.from(uniqueProfiles.keys()))

  if (profilesSelectError) {
    throw new Error(`Failed to get profile IDs: ${profilesSelectError.message}`)
  }

  // Create a map of URN to profile ID
  const urnToIdMap = new Map<string, string>()
  profilesWithIds.forEach((profile: any) => {
    urnToIdMap.set(profile.urn, profile.id)
  })

  // Prepare reactions for insertion
  const reactionsToInsert: Reaction[] = validReactions.map(reaction => {
    const profileId = urnToIdMap.get(reaction.reactor.urn)
    if (!profileId) {
      throw new Error(`Profile ID not found for URN: ${reaction.reactor.urn}`)
    }

    return {
      user_id: userId,
      post_id: post.id,
      reactor_profile_id: profileId,
      reaction_type: reaction.reaction_type,
      scraped_at: new Date().toISOString(),
      page_number: reaction._metadata.page_number
    }
  })

  // Insert reactions with upsert to handle duplicates
  if (reactionsToInsert.length > 0) {
    const { error: reactionsError } = await supabase
      .from('reactions')
      .upsert(reactionsToInsert, {
        onConflict: 'post_id,reactor_profile_id,reaction_type',
        ignoreDuplicates: true
      })

    if (reactionsError) {
      throw new Error(`Failed to insert reactions: ${reactionsError.message}`)
    }
  }

  return validReactions.length
}
