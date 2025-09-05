import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ApifyService, type ApifyCommentData } from '@/lib/services/apify'
import type { Database } from '@/lib/types/database.types'
import type { SupabaseClient } from '@supabase/supabase-js'

type Comment = Database['public']['Tables']['comments']['Insert']

interface CommentAuthor {
  name: string
  headline?: string
  profile_url: string
  profile_picture?: string
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
  totalComments?: number
  processedComments?: number
  totalItems?: number
  processedItems?: number
  error?: string
  result?: Record<string, unknown>
}

interface UserData {
  id: string
}

// Helper function to extract identifiers from LinkedIn profile data (for comments)
function extractProfileIdentifiersFromComment(author: CommentAuthor) {
  let primary_identifier = null
  let secondary_identifier = null
  
  // Extract from profile_url
  if (author.profile_url) {
    const match = author.profile_url.match(/\/in\/([^\/\?]+)/)
    if (match && match[1]) {
      const identifier = match[1]
      
      // If it looks like an internal LinkedIn ID, use as primary
      if (identifier.startsWith('ACoA')) {
        primary_identifier = identifier
      } else {
        // Otherwise it's a vanity URL, use as secondary
        secondary_identifier = identifier
      }
    }
  }
  
  return { primary_identifier, secondary_identifier }
}

// Sophisticated profile upsert function for comments using dual identifier system
async function upsertCommentProfilesWithDualIdentifiers(supabase: SupabaseClient<Database>, profiles: CommentAuthor[]): Promise<UpsertResult> {
  const results = []
  const newlyUpsertedIds = []
  
  for (const author of profiles) {
    const { primary_identifier, secondary_identifier } = extractProfileIdentifiersFromComment(author)
    
    // Extract URN from profile_url for backwards compatibility
    let urn = author.profile_url
    const urlMatch = author.profile_url?.match(/\/in\/([^/?]+)/)
    if (urlMatch) {
      urn = urlMatch[1]
    }
    
    const profileData = {
      urn: urn,
      name: author.name,
      headline: author.headline,
      profile_url: author.profile_url,
      profile_pictures: author.profile_picture ? {
        original: author.profile_picture,
        large: author.profile_picture,
        medium: author.profile_picture,
        small: author.profile_picture
      } : null,
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
    if (!existingProfile && urn) {
      const { data } = await supabase
        .from('profiles')
        .select('id, urn, primary_identifier, secondary_identifier, first_name')
        .eq('urn', urn)
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
    if (!existingProfile && author.name && author.headline) {
      const { data } = await supabase
        .from('profiles')
        .select('id, urn, primary_identifier, secondary_identifier, first_name')
        .eq('name', author.name.trim())
        .eq('headline', author.headline.trim())
        .single()
      
      if (data) {
        existingProfile = data
        console.log(`📎 Found existing profile via name+headline match: ${author.name}`)
      }
    }
    
    if (existingProfile) {
      // Check if this existing profile needs enrichment (missing first_name)
      const needsEnrichment = !existingProfile.first_name || existingProfile.first_name.trim() === ''
      
      // PRESERVE ORIGINAL URN - don't overwrite if it exists and is different
      // This prevents losing track of comments linked to different URN formats
      let preservedUrn = existingProfile.urn
      if (!preservedUrn || preservedUrn.trim() === '') {
        preservedUrn = urn
      } else if (preservedUrn !== urn && urn && urn.trim() !== '') {
        // Different URN detected - log this for visibility
        console.log(`⚠️  Different URN detected for ${author.name}: existing="${preservedUrn}" vs new="${urn}" - preserving original`)
      }
      
      // Update existing profile with new data but preserve original URN
      const updateData: Partial<Database['public']['Tables']['profiles']['Update']> = {
        urn: preservedUrn, // Preserve original URN
        name: author.name,
        headline: author.headline,
        profile_url: author.profile_url,
        profile_pictures: author.profile_picture ? {
          original: author.profile_picture,
          large: author.profile_picture,
          medium: author.profile_picture,
          small: author.profile_picture
        } : null,
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
      if (urn && urn !== preservedUrn) {
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
          console.log(`📝 Will store new URN format as alternative: ${urn}`)
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
        if (urn && urn !== preservedUrn && 
            !updateData.primary_identifier && !updateData.secondary_identifier) {
          try {
            await supabase.rpc('add_alternative_urn', {
              profile_id: existingProfile.id,
              new_urn: urn
            })
            console.log(`✅ Stored alternative URN for ${author.name}: ${urn}`)
          } catch (altUrnError) {
            console.error('Error storing alternative URN:', altUrnError)
          }
        }
        
        results.push(updatedData)
        // If profile needs enrichment, add to newly upserted list
        if (needsEnrichment) {
          newlyUpsertedIds.push(updatedData.id)
        }
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
async function autoEnrichProfiles(supabase: SupabaseClient<Database>, userId: string, progressId: string, newlyUpsertedProfileIds: string[]): Promise<EnrichmentResult> {
  console.log(`🔍 Checking ${newlyUpsertedProfileIds.length} newly discovered profiles for enrichment...`)
  
  // Update progress to show we're checking for enrichment
  const currentProgress = await getProgress(supabase, progressId)
  if (currentProgress) {
    await saveProgress(supabase, progressId, userId, {
      ...currentProgress,
      currentStep: `Checking ${newlyUpsertedProfileIds.length} newly discovered profiles for enrichment...`,
      progress: 91,
      totalItems: newlyUpsertedProfileIds.length, // Set total for progress tracking
      processedItems: 0 // Reset processed count
    })
  }
  
  if (!newlyUpsertedProfileIds || newlyUpsertedProfileIds.length === 0) {
    console.log('✅ No new profiles discovered in this scraping session')
    
    // Update progress to show no new profiles
    if (currentProgress) {
      await saveProgress(supabase, progressId, userId, {
        ...currentProgress,
        currentStep: 'No new profiles discovered • Finishing up...',
        progress: 98
      })
    }
    
    return { enrichedCount: 0, skipped: false }
  }
  
  // Find profiles that need enrichment among the newly discovered ones
  const { data: profilesToEnrich, error: profilesError } = await supabase
    .from('profiles')
    .select('id, profile_url, first_name, enriched_at')
    .in('id', newlyUpsertedProfileIds) // Only check the newly discovered profiles
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
          enriched_at: new Date().toISOString(),
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
    if (currentProgress) {
      await saveProgress(supabase, progressId, userId, {
        ...currentProgress,
        currentStep: `Auto-enriched ${updatedCount} profiles • Completed successfully`
      })
    }
    
    return { enrichedCount: updatedCount, skipped: false }
    
  } catch (enrichError) {
    console.error('Auto-enrichment error:', enrichError)
    // Update progress to show enrichment failed but don't fail the main operation
    if (currentProgress) {
      await saveProgress(supabase, progressId, userId, {
        ...currentProgress,
        currentStep: 'Auto-enrichment failed, but scraping completed successfully'
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

    // Initialize progress tracking in database
    await saveProgress(supabase, progressId, user.id, {
      status: 'starting',
      progress: 0,
      currentStep: 'Initializing LinkedIn Post Comments Scraper...',
      totalPosts: posts.length,
      processedPosts: 0
    })

    // Start the scraping process asynchronously
    processCommentsScraping(progressId, posts, user, userSettings.apify_api_key, supabase)

    return NextResponse.json({ progressId })

  } catch (error) {
    console.error('Error starting comments scraping:', error)
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

async function processCommentsScraping(
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
      commentsCount: number
      profilesCount: number
      status?: string
      error?: string
    }> = []
    const errors: string[] = []
    const allNewlyUpsertedProfileIds: string[] = [] // Track all profiles that need enrichment
    
    // Update progress: Starting scraper
    await saveProgress(supabase, progressId, user.id, {
      status: 'scraping',
      progress: 10,
      currentStep: 'Initializing concurrent scraping jobs...',
      totalPosts: posts.length,
      processedPosts: 0
    })

    // Initialize Apify service
    const apifyService = new ApifyService(apifyApiKey)
    const postUrls = posts.map(p => p.post_url)
    
    // Update: Starting concurrent Apify operations
    await saveProgress(supabase, progressId, user.id, {
      status: 'scraping',
      progress: 15,
      currentStep: `Starting concurrent scraping for ${posts.length} posts...`,
      totalPosts: posts.length,
      processedPosts: 0
    })

    console.log(`🚀 Starting concurrent comments scraping for ${posts.length} posts`)
    
    console.log('🐛 DEBUG: About to call apifyService.scrapeAllPostComments with postUrls:', postUrls)
    const allCommentsData = await apifyService.scrapeAllPostComments(postUrls)
    console.log(`🐛 DEBUG: scrapeAllPostComments returned ${allCommentsData.length} total comments across all posts`)
    
    // Update: All concurrent scraping completed
    await saveProgress(supabase, progressId, user.id, {
      status: 'processing',
      progress: 75,
      currentStep: `LinkedIn Post Comments Scraper completed! Found ${allCommentsData.length} comments • Saving to database...`,
      totalPosts: posts.length,
      processedPosts: 0,
      totalComments: allCommentsData.length
    })

    // Note: Skip redundant progress update - already set above at 75%

    // Group comments by post URL
    const commentsByPostUrl = new Map<string, ApifyCommentData[]>()
    allCommentsData.forEach(comment => {
      const postUrl = comment.post_input // Fix: use correct field name from ApifyCommentData
      if (!commentsByPostUrl.has(postUrl)) {
        commentsByPostUrl.set(postUrl, [])
      }
      commentsByPostUrl.get(postUrl)!.push(comment)
    })

    let successfulPosts = 0

    // Process each post with progressive saving (database operations are fast)
    for (let i = 0; i < posts.length; i++) {
      const post = posts[i]
      const postProgress = 75 + (i / posts.length) * 20 // 75-95% (smaller range since DB ops are fast)

      try {
        // Only update progress every 10 posts or on important posts to avoid spam
        if (i % 10 === 0 || i === posts.length - 1) {
          await saveProgress(supabase, progressId, user.id, {
            status: 'processing',
            progress: postProgress,
            currentStep: `Saving comments to database... (${i + 1}/${posts.length} posts processed)`,
            totalPosts: posts.length,
            processedPosts: i,
            totalComments: allCommentsData.length,
            processedComments: results.reduce((sum, r) => sum + r.commentsCount, 0)
          })
        }

        const postComments = commentsByPostUrl.get(post.post_url) || []
        console.log(`💾 Saving ${postComments.length} comments for post ${post.id}`)
        
        // No separate progress update for individual posts - they're too fast

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
            const uniqueProfiles = new Map<string, CommentAuthor>()
            
            validComments.forEach(comment => {
              // Use profile_url as the unique identifier since we don't have URN (same as regular API)
              if (!uniqueProfiles.has(comment.author.profile_url)) {
                uniqueProfiles.set(comment.author.profile_url, comment.author)
              }
            })

            // Process profiles with sophisticated deduplication (same as reactions)
            const profilesToUpsert = Array.from(uniqueProfiles.values())
            let profilesWithIds: ProfileWithId[] = []
            const newlyUpsertedProfileIds: string[] = []

            if (profilesToUpsert.length > 0) {
              try {
                const upsertResult = await upsertCommentProfilesWithDualIdentifiers(supabase, profilesToUpsert)
                profilesWithIds = upsertResult.profiles
                newlyUpsertedProfileIds.push(...upsertResult.newlyUpsertedIds)
                allNewlyUpsertedProfileIds.push(...upsertResult.newlyUpsertedIds) // Collect for later enrichment
                console.log(`✅ Successfully processed ${profilesWithIds.length} comment profiles for post ${post.id} (${upsertResult.newlyUpsertedIds.length} need enrichment)`)
              } catch (profileError) {
                console.error('Error upserting comment profiles:', profileError)
                errors.push(`Failed to save comment profiles for post ${post.id}: ${profileError instanceof Error ? profileError.message : 'Unknown error'}`)
                profilesWithIds = []
              }
            }

            if (profilesWithIds.length > 0) {
              // Create a map of profile_url to profile ID 
              const urlToIdMap = new Map<string, string>()
              
              // Instead of matching by URN (which might be preserved from earlier), 
              // match by profile_url directly since we know the order
              const uniqueProfilesArray = Array.from(uniqueProfiles.values())
              
              profilesWithIds?.forEach((profile: ProfileWithId, index: number) => {
                // Match by index since upsertCommentProfilesWithDualIdentifiers processes in the same order
                if (index < uniqueProfilesArray.length) {
                  const originalProfile = uniqueProfilesArray[index]
                  urlToIdMap.set(originalProfile.profile_url, profile.id)
                }
              })
              
              // Fallback: if order doesn't work, try to match by extracted URN or name
              if (urlToIdMap.size < uniqueProfilesArray.length) {
                uniqueProfilesArray.forEach(author => {
                  if (!urlToIdMap.has(author.profile_url)) {
                    // Try to find by extracted URN
                    let extractedUrn = author.profile_url
                    const urlMatch = author.profile_url.match(/\/in\/([^/?]+)/)
                    if (urlMatch) {
                      extractedUrn = urlMatch[1]
                    }
                    
                    const matchingProfile = profilesWithIds.find(p => 
                      p.urn === extractedUrn || // Direct URN match
                      author.profile_url.includes(p.urn) // URN is part of the URL
                    )
                    
                    if (matchingProfile) {
                      urlToIdMap.set(author.profile_url, matchingProfile.id)
                    }
                  }
                })
              }

              console.log(`🔗 Mapped ${urlToIdMap.size} profile URLs to IDs for comments`)

              // Prepare comments for insertion
              const comments: Comment[] = validComments.map(comment => {
                const profileId = urlToIdMap.get(comment.author.profile_url)
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

              // Delete existing comments for this post with timeout protection
              console.log(`🗑️ Deleting existing comments for post ${post.id}...`)
              const { error: deleteError } = await Promise.race([
                supabase
                  .from('comments')
                  .delete()
                  .eq('user_id', user.id)
                  .eq('post_id', post.id),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Delete timeout')), 30000))
              ]) as { error: Error | null }

              if (deleteError) {
                console.error('Error deleting existing comments:', deleteError)
                errors.push(`Failed to delete existing comments for post ${post.id}: ${deleteError.message}`)
              }

              // Insert new comments with timeout protection
              console.log(`💾 Inserting ${comments.length} comments for post ${post.id}...`)
              const { error: insertError } = await Promise.race([
                supabase
                  .from('comments')
                  .insert(comments),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Insert timeout')), 30000))
              ]) as { error: Error | null }

              if (insertError) {
                console.error('❌ Error inserting comments:', insertError)
                errors.push(`Failed to insert comments for post ${post.id}: ${insertError.message}`)
                
                results.push({
                  postId: post.id,
                  postUrl: post.post_url,
                  commentsCount: 0,
                  profilesCount: 0,
                  status: 'failed',
                  error: insertError.message
                })
              } else {
                console.log(`✅ Successfully saved ${validComments.length} comments for post ${post.id}`)
                successfulPosts++
                
                results.push({
                  postId: post.id,
                  postUrl: post.post_url,
                  commentsCount: validComments.length,
                  profilesCount: uniqueProfiles.size,
                  status: 'success'
                })
              }
            }
          }

        } else {
          // No comments found - still count as successful
          console.log(`✅ No comments found for post ${post.id} (successful)`)
          successfulPosts++
          results.push({
            postId: post.id,
            postUrl: post.post_url,
            commentsCount: 0,
            profilesCount: 0,
            status: 'success'
          })
        }

        // Update progress: Post completed (only update every few posts to reduce database load)
        if (i % 2 === 0 || i === posts.length - 1) {
          await saveProgress(supabase, progressId, user.id, {
            status: 'processing',
            progress: postProgress + 3,
            currentStep: `Completed post ${i + 1} of ${posts.length} (${results[results.length - 1].commentsCount} comments found)`,
            totalPosts: posts.length,
            processedPosts: i + 1,
            totalComments: allCommentsData.length,
            processedComments: results.reduce((sum, r) => sum + r.commentsCount, 0)
          })
        }

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
        console.error(`❌ Error processing comments for post ${post.id}:`, error)
        errors.push(`Failed to process post ${post.id}: ${error instanceof Error ? error.message : 'Unknown error'}`)
        
        // Add failed post to results for tracking
        results.push({
          postId: post.id,
          postUrl: post.post_url,
          commentsCount: 0,
          profilesCount: 0,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error'
        })
        
        // Continue with next post
        console.log(`⏭️ Continuing with remaining ${posts.length - i - 1} posts...`)
      }
    }

    // Final progress update with partial success tracking
    const totalComments = results.reduce((sum, result) => sum + result.commentsCount, 0)
    const totalProfiles = results.reduce((sum, result) => sum + result.profilesCount, 0)
    const failedPosts = posts.length - successfulPosts
    
    let message = `Comments scraping completed: ${successfulPosts}/${posts.length} posts successful`
    if (totalComments > 0) {
      message += ` • Found ${totalComments} comments from ${totalProfiles} unique profiles`
    }
    
    if (failedPosts > 0) {
      message += ` • ${failedPosts} posts failed (data saved for successful posts)`
    }

    // Determine final status based on results
    const finalStatus = failedPosts === 0 ? 'completed' : 
                       successfulPosts > 0 ? 'completed' : 'error'

    // Set progress to 90% before enrichment
    await saveProgress(supabase, progressId, user.id, {
      status: 'processing',
      progress: 90,
      currentStep: 'LinkedIn Post Comments Scraper completed • Starting LinkedIn Profile Enrichment...',
      totalPosts: posts.length,
      processedPosts: posts.length,
      totalComments,
      processedComments: totalComments
    })

    console.log(`Comments scraping completed for ${posts.length} posts`)

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
        totalComments,
        processedComments: totalComments
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
      status: finalStatus,
      progress: 100,
      currentStep: 'All operations completed successfully',
      totalPosts: posts.length,
      processedPosts: posts.length,
      totalComments,
      processedComments: totalComments,
      processedItems: enrichmentResult.enrichedCount, // Track enriched profiles for UI
      result: {
        message,
        postsProcessed: posts.length,
        successfulPosts,
        failedPosts,
        totalComments,
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
      console.log('Updated last sync time for comments scraping')
    } catch (syncError) {
      console.warn('Failed to update last sync time:', syncError)
      // Don't fail the whole operation for this
    }

  } catch (error) {
    console.error('Error in comments scraping:', error)
    await saveProgress(supabase, progressId, user.id, {
      status: 'error',
      progress: 0,
      currentStep: 'Error occurred',
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    })
  }
}
