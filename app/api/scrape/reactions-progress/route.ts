import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ApifyService, type ApifyReactionData } from '@/lib/services/apify'
import type { Database } from '@/lib/types/database.types'
import type { SupabaseClient } from '@supabase/supabase-js'

type Reaction = Database['public']['Tables']['reactions']['Insert']

interface ReactorProfile {
  urn: string
  name: string
  headline?: string
  profile_url: string
  profile_pictures?: Record<string, unknown>
}

interface ProfileWithId {
  id: string
  urn: string
}

interface UpsertResult {
  profiles: ProfileWithId[]
  newlyUpsertedIds: string[]
}

interface EnrichmentResult {
  enrichedCount: number
  skipped: boolean
  error?: string
}

interface ProgressData {
  status: 'starting' | 'scraping' | 'processing' | 'saving' | 'completed' | 'error'
  progress: number
  currentStep: string
  totalPosts?: number
  processedPosts?: number
  totalReactions?: number
  processedReactions?: number
  totalItems?: number
  processedItems?: number
  error?: string
  result?: Record<string, unknown>
}

interface UserData {
  id: string
}

// Helper function to extract identifiers from LinkedIn profile data
function extractProfileIdentifiers(reactor: ReactorProfile) {
  let primary_identifier = null
  let secondary_identifier = null
  
  // Primary identifier is the URN (internal LinkedIn ID)
  if (reactor.urn && reactor.urn.startsWith('ACoA')) {
    primary_identifier = reactor.urn
  }
  
  // Secondary identifier is the vanity URL part
  if (reactor.profile_url) {
    const match = reactor.profile_url.match(/\/in\/([^\/\?]+)/)
    if (match && match[1]) {
      secondary_identifier = match[1]
      
      // If we don't have a primary identifier, try to use the URN if it looks like an internal ID
      if (!primary_identifier && reactor.urn && reactor.urn.startsWith('ACoA')) {
        primary_identifier = reactor.urn
      }
    }
  }
  
  // Fallback: if URN is a vanity URL, use it as secondary
  if (!secondary_identifier && reactor.urn && !reactor.urn.startsWith('ACoA') && !reactor.urn.startsWith('http')) {
    secondary_identifier = reactor.urn
  }
  
  return { primary_identifier, secondary_identifier }
}

// Sophisticated profile upsert function using dual identifier system
async function upsertProfilesWithDualIdentifiers(supabase: SupabaseClient<Database>, profiles: ReactorProfile[]): Promise<UpsertResult> {
  const results = []
  const newlyUpsertedIds = []
  
  for (const reactor of profiles) {
    const { primary_identifier, secondary_identifier } = extractProfileIdentifiers(reactor)
    
    const profileData: Database['public']['Tables']['profiles']['Insert'] = {
      urn: reactor.urn,
      name: reactor.name,
      headline: reactor.headline,
      profile_url: reactor.profile_url,
      profile_pictures: reactor.profile_pictures as Database['public']['Tables']['profiles']['Insert']['profile_pictures'],
      primary_identifier,
      secondary_identifier
    }
    
    // Try to find existing profile using multiple strategies
    let existingProfile = null
    
    // Strategy 1: Match by primary_identifier (URN)
    if (primary_identifier) {
      const { data } = await supabase
        .from('profiles')
        .select('id, urn, primary_identifier, secondary_identifier, first_name')
        .eq('primary_identifier', primary_identifier)
        .single()
      
      if (data) {
        existingProfile = data
      }
    }
    
    // Strategy 2: Match by secondary_identifier (vanity URL)
    if (!existingProfile && secondary_identifier) {
      const { data } = await supabase
        .from('profiles')
        .select('id, urn, primary_identifier, secondary_identifier, first_name')
        .eq('secondary_identifier', secondary_identifier)
        .single()
      
      if (data) {
        existingProfile = data
      }
    }
    
    // Strategy 3: Match by old urn field (for backwards compatibility)
    if (!existingProfile) {
      const { data } = await supabase
        .from('profiles')
        .select('id, urn, primary_identifier, secondary_identifier, first_name')
        .eq('urn', reactor.urn)
        .single()
      
      if (data) {
        existingProfile = data
      }
    }
    
    // Strategy 4: Match by profile_url pattern
    if (!existingProfile && secondary_identifier) {
      const { data } = await supabase
        .from('profiles')
        .select('id, urn, primary_identifier, secondary_identifier, first_name')
        .ilike('profile_url', `%${secondary_identifier}%`)
        .single()
      
      if (data) {
        existingProfile = data
      }
    }
    
    // Strategy 5: Match by name + headline (for edge cases with completely different identifiers)
    if (!existingProfile && reactor.name && reactor.headline) {
      const { data } = await supabase
        .from('profiles')
        .select('id, urn, primary_identifier, secondary_identifier, first_name')
        .eq('name', reactor.name.trim())
        .eq('headline', reactor.headline.trim())
        .single()
      
      if (data) {
        existingProfile = data
        console.log(`📎 Found existing profile via name+headline match: ${reactor.name}`)
      }
    }
    
    if (existingProfile) {
      // Check if this existing profile needs enrichment (missing first_name)
      // const needsEnrichment = !existingProfile.first_name || existingProfile.first_name.trim() === ''
      
      // PRESERVE ORIGINAL URN - don't overwrite if it exists and is different
      // This prevents losing track of reactions/comments linked to different URN formats
      let preservedUrn = existingProfile.urn
      if (!preservedUrn || preservedUrn.trim() === '') {
        preservedUrn = reactor.urn
      } else if (preservedUrn !== reactor.urn && reactor.urn && reactor.urn.trim() !== '') {
        // Different URN detected - log this for visibility
        console.log(`⚠️  Different URN detected for ${reactor.name}: existing="${preservedUrn}" vs new="${reactor.urn}" - preserving original`)
      }
      
      // Update existing profile with new data but preserve original URN
      const updateData: Partial<Database['public']['Tables']['profiles']['Update']> = {
        urn: preservedUrn, // Preserve original URN
        name: reactor.name,
        headline: reactor.headline,
        profile_url: reactor.profile_url,
        profile_pictures: reactor.profile_pictures as Database['public']['Tables']['profiles']['Insert']['profile_pictures'],
        last_updated: new Date().toISOString()
      }
      
      // Update identifiers - add new ones if missing, but don't overwrite existing ones
      if (!existingProfile.primary_identifier && primary_identifier) {
        updateData.primary_identifier = primary_identifier
      }
      if (!existingProfile.secondary_identifier && secondary_identifier) {
        updateData.secondary_identifier = secondary_identifier
      }
      
      // If we have a different URN format, try to store it in the appropriate identifier field
      if (reactor.urn && reactor.urn !== preservedUrn) {
        const newPrimaryId = primary_identifier
        const newSecondaryId = secondary_identifier
        
        // If the new URN would fit in primary_identifier and that field is empty
        if (!existingProfile.primary_identifier && newPrimaryId && newPrimaryId !== existingProfile.secondary_identifier) {
          updateData.primary_identifier = newPrimaryId
          console.log(`📝 Storing new URN format in primary_identifier: ${newPrimaryId}`)
        }
        // If the new URN would fit in secondary_identifier and that field is empty  
        else if (!existingProfile.secondary_identifier && newSecondaryId && newSecondaryId !== existingProfile.primary_identifier) {
          updateData.secondary_identifier = newSecondaryId
          console.log(`📝 Storing new URN format in secondary_identifier: ${newSecondaryId}`)
        }
        // As a fallback, store the different URN format in alternative_urns array
        else {
          // We'll call a separate function after the main update to add alternative URN
          console.log(`📝 Will store new URN format as alternative: ${reactor.urn}`)
        }
      }
      
      const { data: updatedData, error } = await supabase
        .from('profiles')
        .update(updateData)
        .eq('id', existingProfile.id)
        .select('id, urn')
        .single()
      
      if (!error && updatedData) {
        // If we have a different URN that couldn't be stored in primary/secondary identifiers,
        // store it as an alternative URN
        if (reactor.urn && reactor.urn !== preservedUrn && 
            !updateData.primary_identifier && !updateData.secondary_identifier) {
          try {
            await supabase.rpc('add_alternative_urn', {
              profile_id: existingProfile.id,
              new_urn: reactor.urn
            })
            console.log(`✅ Stored alternative URN for ${reactor.name}: ${reactor.urn}`)
          } catch (altUrnError) {
            console.error('Error storing alternative URN:', altUrnError)
          }
        }
        
        results.push(updatedData)
        // DON'T add existing profiles to newlyUpsertedIds - they're not new!
        // Only truly new profiles should be in the newly upserted list
      } else {
        console.error('Error updating existing profile:', error)
      }
    } else {
      // Create new profile
      const { data: newData, error } = await supabase
        .from('profiles')
        .insert(profileData)
        .select('id, urn')
        .single()
      
      if (!error && newData) {
        results.push(newData)
        // New profiles always need enrichment
        newlyUpsertedIds.push(newData.id)
      } else {
        console.error('Error creating new profile:', error)
      }
    }
  }
  
  return { profiles: results, newlyUpsertedIds }
}

// Auto-enrichment function for newly discovered profiles
async function autoEnrichProfiles(supabase: SupabaseClient<Database>, userId: string, progressId: string, newlyUpsertedProfileIds: string[], allProcessedProfileIds: string[]): Promise<EnrichmentResult> {
  console.log(`🔍 Checking ${newlyUpsertedProfileIds.length} newly created profiles and ${allProcessedProfileIds.length - newlyUpsertedProfileIds.length} updated profiles for enrichment...`)
  
  // Update progress to show we're checking for enrichment
  const currentProgress = await getProgress(supabase, progressId)
  if (currentProgress) {
    await saveProgress(supabase, progressId, userId, {
      ...currentProgress,
      currentStep: `Checking ${allProcessedProfileIds.length} profiles for enrichment (${newlyUpsertedProfileIds.length} new, ${allProcessedProfileIds.length - newlyUpsertedProfileIds.length} updated)...`,
      progress: 91,
      totalItems: allProcessedProfileIds.length, // Set total for progress tracking
      processedItems: 0 // Reset processed count
    })
  }
  
  if (!allProcessedProfileIds || allProcessedProfileIds.length === 0) {
    console.log('✅ No profiles processed in this scraping session')
    
    // Update progress to show no profiles processed
    if (currentProgress) {
      await saveProgress(supabase, progressId, userId, {
        ...currentProgress,
        currentStep: 'No profiles processed • Finishing up...',
        progress: 98
      })
    }
    
    return { enrichedCount: 0, skipped: false }
  }
  
  // Find profiles that need enrichment among ALL processed profiles (new + updated)
  const { data: profilesToEnrich, error: profilesError } = await supabase
    .from('profiles')
    .select('id, profile_url, first_name, last_enriched_at')
    .in('id', allProcessedProfileIds) // Check all processed profiles, not just new ones
    .or('first_name.is.null,first_name.eq.')
    .not('profile_url', 'ilike', '%/company/%') // Exclude company profiles
  
  if (profilesError) {
    console.error('Error fetching profiles for auto-enrichment:', profilesError)
    return { enrichedCount: 0, skipped: false, error: profilesError.message }
  }
  
  if (!profilesToEnrich || profilesToEnrich.length === 0) {
    console.log('✅ No profiles need enrichment')
    
    // Update progress to show no enrichment needed
    if (currentProgress) {
      await saveProgress(supabase, progressId, userId, {
        ...currentProgress,
        currentStep: 'Checked for enrichment: 0 profiles need enrichment • Finishing up...',
        progress: 98
      })
    }
    
    return { enrichedCount: 0, skipped: false }
  }
  
  console.log(`🚀 Auto-enriching ${profilesToEnrich.length} profiles...`)
  
  // Update progress to show enrichment is starting with profile count
  if (currentProgress) {
    await saveProgress(supabase, progressId, userId, {
      ...currentProgress,
      currentStep: `Found ${profilesToEnrich.length} profiles needing enrichment • Preparing for LinkedIn Profile Enrichment...`,
      progress: 92,
      totalItems: profilesToEnrich.length, // Update total to profiles that actually need enrichment
      processedItems: 0 // Reset processed count
    })
  }
  
  // Get user's Apify API key
  const { data: userSettings, error: settingsError } = await supabase
    .from('user_settings')
    .select('apify_api_key')
    .eq('user_id', userId)
    .single()

  if (settingsError || !userSettings?.apify_api_key) {
    console.warn('No Apify API key found for auto-enrichment')
    
    // Update progress to show enrichment skipped
    if (currentProgress) {
      await saveProgress(supabase, progressId, userId, {
        ...currentProgress,
        currentStep: 'Auto-enrichment skipped (no API key) • Finishing up...',
        progress: 98
      })
    }
    
    return { enrichedCount: 0, skipped: true, error: 'No Apify API key found' }
  }
  
  try {
    // Initialize Apify service
    const apifyService = new ApifyService(userSettings.apify_api_key)
    
    // Extract profile identifiers from URLs
    const profileIdentifiers = profilesToEnrich.map(profile => {
      const match = profile.profile_url?.match(/\/in\/([^\/\?]+)/)
      return match ? match[1] : profile.profile_url
    }).filter((id): id is string => Boolean(id))
    
    if (profileIdentifiers.length === 0) {
      console.warn('No valid profile identifiers found for enrichment')
      return { enrichedCount: 0, skipped: false, error: 'No valid profile identifiers found' }
    }
    
    // Call enrichment service with progress updates
    console.log(`📞 Calling Apify enrichment for ${profileIdentifiers.length} profiles`)
    
    // Update progress during Apify call
    const enrichProgress = await getProgress(supabase, progressId)
    if (enrichProgress) {
      await saveProgress(supabase, progressId, userId, {
        ...enrichProgress,
        currentStep: `Sending ${profileIdentifiers.length} profiles to LinkedIn Profile Enrichment Scraper...`,
        progress: 94
      })
    }
    
    // Quick update to show we're now waiting for results
    setTimeout(async () => {
      const waitingProgress = await getProgress(supabase, progressId)
      if (waitingProgress) {
        await saveProgress(supabase, progressId, userId, {
          ...waitingProgress,
          currentStep: `Waiting for LinkedIn Profile Enrichment results (${profileIdentifiers.length} profiles processing...)`,
          progress: 95
        })
      }
    }, 500) // Half second delay to show transition
    
    const enrichedData = await apifyService.enrichAllProfiles(profileIdentifiers, false)
    
    if (!enrichedData || enrichedData.length === 0) {
      console.warn('No enriched data returned from Apify')
      
      // Update progress to show no data returned
      const noDataProgress = await getProgress(supabase, progressId)
      if (noDataProgress) {
        await saveProgress(supabase, progressId, userId, {
          ...noDataProgress,
          currentStep: 'No enriched data returned from Apify • Finishing up...',
          progress: 98
        })
      }
      
      return { enrichedCount: 0, skipped: false, error: 'No enriched data returned from Apify' }
    }
    
    console.log(`✅ Received enriched data for ${enrichedData.length} profiles`)
    
    // Update progress for processing phase
    const processProgress = await getProgress(supabase, progressId)
    if (processProgress) {
      await saveProgress(supabase, progressId, userId, {
        ...processProgress,
        currentStep: `LinkedIn Profile Enrichment completed! Processing ${enrichedData.length} enriched profiles...`,
        progress: 96
      })
    }
    
    // Process and save enriched data (similar to enrich-profiles-progress route)
    const validEnrichedProfiles = enrichedData.filter(profile => 
      profile.basic_info && !(profile.basic_info as Record<string, unknown>).error_message?.toString().includes('No profile found')
    )
    
    let updatedCount = 0
    
    for (const enrichedProfile of validEnrichedProfiles) {
      try {
        const basicInfo = enrichedProfile.basic_info
        const currentExperience = enrichedProfile.experience?.find(exp => exp.is_current)
        
        const updateData = {
          first_name: basicInfo.first_name || null,
          last_name: basicInfo.last_name || null,
          profile_picture_url: basicInfo.profile_picture_url || null,
          country: basicInfo.location?.country || null,
          city: basicInfo.location?.city || null,
          current_title: currentExperience?.title || null,
          current_company: currentExperience?.company || null,
          is_current_position: currentExperience?.is_current || false,
          company_linkedin_url: currentExperience?.company_linkedin_url || null,
          public_identifier: basicInfo.public_identifier || null,
          primary_identifier: basicInfo.urn || null,
          secondary_identifier: basicInfo.public_identifier || enrichedProfile.profileUrl || null,
          last_enriched_at: new Date().toISOString()
        }
        
        // Enhanced matching strategies using all available identifiers
        let updated = false
        
        // Strategy 1: Match by primary_identifier (URN)
        if (basicInfo.urn && !updated) {
          const { data } = await supabase.from('profiles').update(updateData).eq('primary_identifier', basicInfo.urn).select()
          if (data && data.length > 0) {
            updatedCount += data.length
            updated = true
          }
        }
        
        // Strategy 2: Match by secondary_identifier (public identifier)
        if (!updated && basicInfo.public_identifier) {
          const { data } = await supabase.from('profiles').update(updateData).eq('secondary_identifier', basicInfo.public_identifier).select()
          if (data && data.length > 0) {
            updatedCount += data.length
            updated = true
          }
        }
        
        // Strategy 3: Match by legacy urn field (for existing profiles)
        if (!updated && basicInfo.urn) {
          const { data } = await supabase.from('profiles').update(updateData).eq('urn', basicInfo.urn).select()
          if (data && data.length > 0) {
            updatedCount += data.length
            updated = true
          }
        }
        
        // Strategy 4: Match by legacy urn field using public identifier
        if (!updated && basicInfo.public_identifier) {
          const { data } = await supabase.from('profiles').update(updateData).eq('urn', basicInfo.public_identifier).select()
          if (data && data.length > 0) {
            updatedCount += data.length
            updated = true
          }
        }
        
        // Strategy 5: Match by profile_url pattern (public identifier)
        if (!updated && basicInfo.public_identifier) {
          const { data } = await supabase.from('profiles').update(updateData).ilike('profile_url', `%${basicInfo.public_identifier}%`).select()
          if (data && data.length > 0) {
            updatedCount += data.length
            updated = true
          }
        }
        
        // Strategy 6: Match by profile_url pattern (URN)
        if (!updated && basicInfo.urn) {
          const { data } = await supabase.from('profiles').update(updateData).ilike('profile_url', `%${basicInfo.urn}%`).select()
          if (data && data.length > 0) {
            updatedCount += data.length
            updated = true
          }
        }
        
      } catch (updateError) {
        console.error('Error updating profile during auto-enrichment:', updateError)
      }
    }
    
    console.log(`🎉 Auto-enrichment completed: ${updatedCount} profiles updated`)
    
    // Update progress to show enrichment completed
    const finalProgress = await getProgress(supabase, progressId)
    if (finalProgress) {
      await saveProgress(supabase, progressId, userId, {
        ...finalProgress,
        currentStep: `Auto-enriched ${updatedCount} profiles • Finishing up...`,
        progress: 98
      })
    }
    
    return { enrichedCount: updatedCount, skipped: false }
    
  } catch (enrichError) {
    console.error('Auto-enrichment error:', enrichError)
    
    // Update progress to show enrichment failed but don't fail the main operation
    const failProgress = await getProgress(supabase, progressId)
    if (failProgress) {
      await saveProgress(supabase, progressId, userId, {
        ...failProgress,
        currentStep: 'Auto-enrichment failed • Finishing up...',
        progress: 97
      })
    }
    
    return { enrichedCount: 0, skipped: false, error: enrichError instanceof Error ? enrichError.message : 'Unknown error' }
  }
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

    // Initialize progress tracking
    await saveProgress(supabase, progressId, user.id, {
      status: 'starting',
      progress: 0,
      currentStep: 'Initializing LinkedIn Post Reactions Scraper...',
      totalPosts: posts.length,
      processedPosts: 0
    })

    // Start the scraping process asynchronously
    processReactionsScraping(progressId, posts, user, userSettings.apify_api_key, supabase)

    return NextResponse.json({ progressId })

  } catch (error) {
    console.error('Error starting reactions scraping:', error)
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

    // Clean up completed/error entries after they're retrieved (extended delay to ensure frontend gets results)
    if (progress.status === 'completed' || progress.status === 'error') {
      setTimeout(async () => {
        await supabase.from('api_progress').delete().eq('id', progressId)
      }, 120000) // 2 minutes instead of 30 seconds
    }

    // Debug logging for progress response
    console.log(`📊 Returning progress for ${progressId}:`, {
      status: progress.status,
      progress: progress.progress,
      currentStep: progress.currentStep,
      hasResult: !!progress.result,
      resultKeys: progress.result ? Object.keys(progress.result) : []
    })
    
    return NextResponse.json(progress)
  } catch (error) {
    console.error('Error retrieving progress:', error)
    return NextResponse.json({ error: 'Failed to retrieve progress' }, { status: 500 })
  }
}

async function processReactionsScraping(
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
      reactionsCount: number
      profilesCount: number
    }> = []
    const errors: string[] = []
    const allNewlyUpsertedProfileIds: string[] = [] // Track all profiles that need enrichment

    // Update progress: Starting scraper
    await saveProgress(supabase, progressId, user.id, {
      status: 'scraping',
      progress: 10,
      currentStep: 'Starting LinkedIn Post Reactions Scraper...',
      totalPosts: posts.length,
      processedPosts: 0
    })

    // Initialize Apify service
    const apifyService = new ApifyService(apifyApiKey)
    const postUrls = posts.map(p => p.post_url)

    // Update: Starting concurrent scraping
    await saveProgress(supabase, progressId, user.id, {
      status: 'scraping',
      progress: 20,
      currentStep: `LinkedIn Post Reactions Scraper processing ${posts.length} posts...`,
      totalPosts: posts.length,
      processedPosts: 0
    })

    console.log(`Starting concurrent reactions scraping for ${posts.length} posts`)
    
    // Scrape all reactions concurrently (much faster!)
    const allReactionsData = await apifyService.scrapeAllPostReactionsConcurrent(postUrls, 32)
    console.log(`Found ${allReactionsData.length} total reactions across all posts`)

    // Update: Concurrent scraping completed, now processing results
    await saveProgress(supabase, progressId, user.id, {
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
        await saveProgress(supabase, progressId, user.id, {
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
        await saveProgress(supabase, progressId, user.id, {
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
            // Process profiles with sophisticated deduplication
            const uniqueProfiles = new Map<string, ReactorProfile>()
            
            validReactions.forEach(reaction => {
              // Use a composite key for better deduplication
              const { primary_identifier, secondary_identifier } = extractProfileIdentifiers(reaction.reactor)
              const key = primary_identifier || secondary_identifier || reaction.reactor.urn
              
              if (!uniqueProfiles.has(key)) {
                uniqueProfiles.set(key, reaction.reactor)
              }
            })

            // Upsert profiles using new dual identifier system
            const profilesToUpsert = Array.from(uniqueProfiles.values())
            let profilesWithIds: ProfileWithId[] = []
            const newlyUpsertedProfileIds: string[] = []

            if (profilesToUpsert.length > 0) {
              try {
                const upsertResult = await upsertProfilesWithDualIdentifiers(supabase, profilesToUpsert)
                profilesWithIds = upsertResult.profiles
                newlyUpsertedProfileIds.push(...upsertResult.newlyUpsertedIds)
                allNewlyUpsertedProfileIds.push(...upsertResult.newlyUpsertedIds) // Collect for later enrichment
                console.log(`✅ Successfully processed ${profilesWithIds.length} profiles for post ${post.id} (${upsertResult.newlyUpsertedIds.length} need enrichment)`)
              } catch (profileError) {
                console.error('Error upserting profiles:', profileError)
                errors.push(`Failed to save profiles for post ${post.id}: ${profileError instanceof Error ? profileError.message : 'Unknown error'}`)
                profilesWithIds = []
              }
            }

            if (profilesWithIds.length > 0) {
              // Create a map of reactor URN to profile ID  
              const urnToIdMap = new Map<string, string>()
              
              // Instead of relying on URN match (which might be preserved from earlier),
              // match by order and fall back to URN/identifier matching
              const uniqueProfilesArray = Array.from(uniqueProfiles.values())
              
              profilesWithIds?.forEach((profile: ProfileWithId, index: number) => {
                // Primary: match by index since upsertProfilesWithDualIdentifiers processes in the same order
                if (index < uniqueProfilesArray.length) {
                  const originalReactor = uniqueProfilesArray[index]
                  urnToIdMap.set(originalReactor.urn, profile.id)
                }
                
                // Also add the returned profile URN for fallback matching
                urnToIdMap.set(profile.urn, profile.id)
              })
              
              // Additional fallback: try to match by primary/secondary identifiers
              uniqueProfilesArray.forEach(reactor => {
                if (!urnToIdMap.has(reactor.urn)) {
                  const { primary_identifier, secondary_identifier } = extractProfileIdentifiers(reactor)
                  
                  const matchingProfile = profilesWithIds.find(p => 
                    p.urn === primary_identifier || 
                    p.urn === secondary_identifier ||
                    (reactor.profile_url && reactor.profile_url.includes(p.urn))
                  )
                  
                  if (matchingProfile) {
                    urnToIdMap.set(reactor.urn, matchingProfile.id)
                  }
                }
              })

              console.log(`🔗 Mapped ${urnToIdMap.size} reactor URNs to profile IDs`)

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
                  page_number: (reaction._metadata as Record<string, unknown>)?.page_number as number || 1
                }
              })

              // Delete existing reactions for this post with timeout protection
              console.log(`🗑️ Deleting existing reactions for post ${post.id}...`)
              const { error: deleteError } = await Promise.race([
                supabase
                  .from('reactions')
                  .delete()
                  .eq('user_id', user.id)
                  .eq('post_id', post.id),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Delete timeout')), 30000))
              ]) as { error: Error | null }

              if (deleteError) {
                console.error('Error deleting existing reactions:', deleteError)
                errors.push(`Failed to delete existing reactions for post ${post.id}: ${deleteError.message}`)
              }

              // Insert reactions with timeout protection
              console.log(`💾 Inserting ${reactions.length} reactions for post ${post.id}...`)
              const { error: insertError } = await Promise.race([
                supabase
                  .from('reactions')
                  .insert(reactions),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Insert timeout')), 30000))
              ]) as { error: Error | null }

              if (insertError) {
                console.error('Error inserting reactions:', insertError)
                errors.push(`Failed to insert reactions for post ${post.id}: ${insertError.message}`)
              } else {
                console.log(`✅ Successfully saved ${reactions.length} reactions for post ${post.id}`)
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

        // Update progress: Post completed (only update every few posts to reduce database load)
        if (i % 2 === 0 || i === posts.length - 1) {
          await saveProgress(supabase, progressId, user.id, {
            status: 'scraping',
            progress: baseProgress + 8,
            currentStep: `Completed post ${i + 1} of ${posts.length} (${results[results.length - 1].reactionsCount} reactions found)`,
            totalPosts: posts.length,
            processedPosts: i + 1,
            totalReactions: results.reduce((sum, r) => sum + r.reactionsCount, 0)
          })
        }

      } catch (error) {
        console.error(`Error scraping reactions for post ${post.id}:`, error)
        errors.push(`Failed to scrape post ${post.id}: ${error instanceof Error ? error.message : 'Unknown error'}`)
        
        // Update progress: Error occurred for this post
        await saveProgress(supabase, progressId, user.id, {
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

    // Set progress to 90% before enrichment
    await saveProgress(supabase, progressId, user.id, {
      status: 'processing',
      progress: 90,
      currentStep: 'LinkedIn Post Reactions Scraper completed • Starting LinkedIn Profile Enrichment...',
      totalPosts: posts.length,
      processedPosts: posts.length,
      totalReactions,
      processedReactions: totalReactions
    })

    console.log(`Reactions scraping completed for ${posts.length} posts`)

    // Auto-enrich newly discovered profiles with visible progress
    let enrichmentResult = { enrichedCount: 0, skipped: true }
    try {
      console.log(`🎯 Starting auto-enrichment for ${allNewlyUpsertedProfileIds.length} newly discovered profiles`)
      enrichmentResult = await autoEnrichProfiles(supabase, user.id, progressId, allNewlyUpsertedProfileIds)
    } catch (enrichError) {
      console.warn('Auto-enrichment failed:', enrichError)
      // Update progress to show enrichment failed but don't fail the whole operation
      await saveProgress(supabase, progressId, user.id, {
        status: 'processing',
        progress: 95,
        currentStep: 'Auto-enrichment failed, but scraping completed successfully',
        totalPosts: posts.length,
        processedPosts: posts.length,
        totalReactions,
        processedReactions: totalReactions
      })
    }

    // Update final message with enrichment results
    if (enrichmentResult.enrichedCount > 0) {
      message += ` • Auto-enriched ${enrichmentResult.enrichedCount} profiles`
    } else if (!enrichmentResult.skipped) {
      message += ' • No profiles needed enrichment'
    }

    // NOW mark as completed with final results
    await saveProgress(supabase, progressId, user.id, {
      status: 'completed',
      progress: 100,
      currentStep: 'All operations completed successfully',
      totalPosts: posts.length,
      processedPosts: posts.length,
      totalReactions,
      processedReactions: totalReactions,
      processedItems: enrichmentResult.enrichedCount, // Track enriched profiles for UI
      result: {
        message,
        postsProcessed: posts.length,
        totalReactions,
        totalProfiles,
        enrichedProfiles: enrichmentResult.enrichedCount,
        results,
        errors
      }
    })

    // Update last sync time to mark this as a completed scraping session
    try {
      await supabase
        .from('user_settings')
        .update({ last_sync_time: new Date().toISOString() })
        .eq('user_id', user.id)
      console.log('Updated last sync time for reactions scraping')
    } catch (syncError) {
      console.warn('Failed to update last sync time:', syncError)
      // Don't fail the whole operation for this
    }

  } catch (error) {
    console.error('Error in reactions scraping:', error)
    await saveProgress(supabase, progressId, user.id, {
      status: 'error',
      progress: 0,
      currentStep: 'Error occurred',
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    })
  }
}
