import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import ApifyService, { ApifyProfileEnrichmentData } from '@/lib/services/apify'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  
  try {
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user settings for API key
    const { data: settings, error: settingsError } = await supabase
      .from('user_settings')
      .select('apify_api_key')
      .eq('user_id', user.id)
      .single()

    if (settingsError || !settings?.apify_api_key) {
      return NextResponse.json({ 
        error: 'Apify API key not found. Please configure it in settings.' 
      }, { status: 400 })
    }

    const body = await request.json()
    const { profileIds } = body

    if (!profileIds || !Array.isArray(profileIds) || profileIds.length === 0) {
      return NextResponse.json({ 
        error: 'profileIds array is required' 
      }, { status: 400 })
    }

    // Stream response for progress updates
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        processEnrichment(controller, encoder, supabase, user.id, settings.apify_api_key, profileIds).catch(error => {
          console.error('Error in processEnrichment:', error)
        })
      }
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      }
    })

  } catch (error) {
    console.error('Error in enrich-profiles-progress:', error)
    return NextResponse.json({ 
      error: 'Internal server error' 
    }, { status: 500 })
  }
}

async function processEnrichment(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  supabase: any,
  userId: string,
  apiKey: string,
  profileIds: string[]
) {
  try {
    // Send initial progress
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
      progress: 0,
      total: 100,
      currentStep: 'Initializing profile enrichment...',
      profilesProcessed: 0,
      totalProfiles: profileIds.length
    })}\n\n`))

    // Get profiles to enrich by checking which profiles belong to this user through reactions/comments
    // Handle large profile ID arrays by chunking them to avoid "414 Request-URI Too Large" errors
    const CHUNK_SIZE = 50 // Process profiles in chunks of 50
    const allProfiles = []
    
    for (let i = 0; i < profileIds.length; i += CHUNK_SIZE) {
      const chunk = profileIds.slice(i, i + CHUNK_SIZE)
      
      const { data: chunkProfiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, profile_url, urn, name')
        .in('id', chunk)

      if (profilesError) {
        throw new Error(`Failed to fetch profiles chunk: ${profilesError.message}`)
      }

      if (chunkProfiles) {
        allProfiles.push(...chunkProfiles)
      }
    }

    const profiles = allProfiles

    // Validate that these profiles actually belong to this user by checking reactions/comments
    const { data: userPosts, error: userPostsError } = await supabase
      .from('posts')
      .select('id')
      .eq('user_id', userId)

    if (userPostsError) {
      throw new Error(`Failed to fetch user posts: ${userPostsError.message}`)
    }

    const userPostIds = userPosts.map(p => p.id)

    // Try to validate profiles, but continue if validation fails
    let userProfiles = profiles
    
    try {
      // Check if selected profiles have engaged with user's posts
      // Use chunking to avoid "414 Request-URI Too Large" errors
      const allValidReactions = []
      const allValidComments = []
      
      for (let i = 0; i < profileIds.length; i += CHUNK_SIZE) {
        const chunk = profileIds.slice(i, i + CHUNK_SIZE)
        
        try {
          // Check reactions for this chunk
          const { data: validProfiles, error: validationError } = await supabase
            .from('reactions')
            .select('reactor_profile_id')
            .in('post_id', userPostIds)
            .in('reactor_profile_id', chunk)

          if (!validationError && validProfiles) {
            allValidReactions.push(...validProfiles)
          }

          // Check comments for this chunk
          const { data: validCommentProfiles, error: commentValidationError } = await supabase
            .from('comments')
            .select('commenter_profile_id')
            .in('post_id', userPostIds)
            .in('commenter_profile_id', chunk)

          if (!commentValidationError && validCommentProfiles) {
            allValidComments.push(...validCommentProfiles)
          }
        } catch (chunkError) {
          console.warn(`Chunk validation failed, continuing anyway:`, chunkError)
        }
      }

      // If we got any validation results, use them
      if (allValidReactions.length > 0 || allValidComments.length > 0) {
        const validProfileIds = new Set([
          ...(allValidReactions?.map(r => r.reactor_profile_id) || []),
          ...(allValidComments?.map(c => c.commenter_profile_id) || [])
        ])
        userProfiles = profiles.filter(p => validProfileIds.has(p.id))
        console.log(`Profile validation successful: ${userProfiles.length} valid profiles found`)
      } else {
        console.log(`Profile validation returned no results, using all ${profiles.length} selected profiles`)
      }
    } catch (validationError) {
      console.warn('Profile validation failed, using all selected profiles:', validationError)
      userProfiles = profiles
    }

    if (!userProfiles || userProfiles.length === 0) {
      throw new Error('No profiles provided for enrichment')
    }

    // Extract profile identifiers for Apify (not full URLs, just the ID part)
    const profileIdentifiers = userProfiles
      .map(p => {
        if (!p.profile_url) return null
        // Extract the identifier from LinkedIn URL
        // From: "https://www.linkedin.com/in/ACoAAAK4z84B7h32wBsGI7TPe4819oXV20i8GaA"
        // To: "ACoAAAK4z84B7h32wBsGI7TPe4819oXV20i8GaA"
        const match = p.profile_url.match(/\/in\/([^\/\?]+)/)
        return match ? match[1] : null
      })
      .filter(id => id !== null) as string[]

    if (profileIdentifiers.length === 0) {
      throw new Error('No valid profile identifiers found')
    }

    console.log(`Extracted ${profileIdentifiers.length} profile identifiers:`, profileIdentifiers.slice(0, 5))

    // Calculate optimal batch strategy
    const BATCH_SIZE = 50
    const MAX_CONCURRENT = 32
    const totalBatches = Math.ceil(profileIdentifiers.length / BATCH_SIZE)
    const willRunConcurrently = Math.min(totalBatches, MAX_CONCURRENT)
    
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
      progress: 10,
      total: 100,
      currentStep: `Found ${profileIdentifiers.length} profiles to enrich in ${totalBatches} batches (${willRunConcurrently} concurrent runs)...`,
      profilesProcessed: 0,
      totalProfiles: profileIdentifiers.length
    })}\n\n`))

    // Initialize Apify service
    const apifyService = new ApifyService(apiKey)

    // Enrich profiles with progress tracking
    const enrichedProfiles = await apifyService.enrichAllProfiles(
      profileIdentifiers,
      false, // includeEmail
      (current, total, message) => {
        const progress = Math.round(10 + (current / total) * 70) // 10-80% for enrichment
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          progress,
          total: 100,
          currentStep: `${message} (${willRunConcurrently} runs active)`,
          profilesProcessed: Math.round((current / total) * profileIdentifiers.length),
          totalProfiles: profileIdentifiers.length
        })}\n\n`))
      }
    )

    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
      progress: 80,
      total: 100,
      currentStep: `Enriched ${enrichedProfiles.length} profiles. Processing data...`,
      profilesProcessed: enrichedProfiles.length,
      totalProfiles: profileIdentifiers.length
    })}\n\n`))

    // Debug: Log first enriched profile structure
    if (enrichedProfiles.length > 0) {
      console.log('🐛 DEBUG: First enriched profile structure:', JSON.stringify(enrichedProfiles[0], null, 2))
    }

    // Filter out error responses and only process successful enrichments
    const validEnrichedProfiles = enrichedProfiles.filter(profile => 
      profile.basic_info && 
      !profile.message?.includes('No profile found')
    )

    console.log(`🐛 DEBUG: ${enrichedProfiles.length} total responses, ${validEnrichedProfiles.length} valid profiles`)

    // Process and save enriched data
    const updatePromises = validEnrichedProfiles.map(async (enrichedProfile) => {
      try {

        // Find current experience (is_current: true) or latest experience
        const currentExperience = enrichedProfile.experience?.find?.(exp => exp.is_current) || 
                                 enrichedProfile.experience?.[0] || null // First is usually most recent

        // Create update object - safely handle missing basic_info
        const basicInfo = enrichedProfile.basic_info || {}
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
          enriched_at: new Date().toISOString()
        }

        // Update profile using comprehensive matching strategies
        let updateError = null
        let updatedCount = 0
        let matchedBy = ''
        
        // Strategy 1: Match by primary_identifier (URN)
        if (basicInfo.urn) {
          const { error, data } = await supabase
            .from('profiles')
            .update(updateData)
            .eq('primary_identifier', basicInfo.urn)
            .select()
          updateError = error
          updatedCount = data?.length || 0
          if (updatedCount > 0) matchedBy = 'primary_identifier'
        }
        
        // Strategy 2: Match by secondary_identifier (public identifier)
        if (updatedCount === 0 && (basicInfo.public_identifier || enrichedProfile.profileUrl)) {
          const identifier = basicInfo.public_identifier || enrichedProfile.profileUrl
          const { error, data } = await supabase
            .from('profiles')
            .update(updateData)
            .eq('secondary_identifier', identifier)
            .select()
          if (!updateError) updateError = error
          updatedCount = data?.length || 0
          if (updatedCount > 0) matchedBy = 'secondary_identifier'
        }
        
        // Strategy 3: Match by legacy URN field (backward compatibility)
        if (updatedCount === 0 && basicInfo.urn) {
          const { error, data } = await supabase
            .from('profiles')
            .update(updateData)
            .eq('urn', basicInfo.urn)
            .select()
          if (!updateError) updateError = error
          updatedCount = data?.length || 0
          if (updatedCount > 0) matchedBy = 'urn'
        }
        
        // Strategy 4: Match by public_identifier in profile_url (legacy)
        if (updatedCount === 0 && basicInfo.public_identifier) {
          const { error, data } = await supabase
            .from('profiles')
            .update(updateData)
            .ilike('profile_url', `%${basicInfo.public_identifier}%`)
            .select()
          if (!updateError) updateError = error
          updatedCount = data?.length || 0
          if (updatedCount > 0) matchedBy = 'profile_url_pattern'
        }
        
        // Strategy 5: Match by profileUrl in profile_url (fallback)
        if (updatedCount === 0 && enrichedProfile.profileUrl) {
          const { error, data } = await supabase
            .from('profiles')
            .update(updateData)
            .ilike('profile_url', `%${enrichedProfile.profileUrl}%`)
            .select()
          if (!updateError) updateError = error
          updatedCount = data?.length || 0
          if (updatedCount > 0) matchedBy = 'profile_url_fallback'
        }

        if (updateError) {
          console.error('❌ Error updating profile:', basicInfo.urn || enrichedProfile.profileUrl, updateError)
        } else if (updatedCount > 0) {
          console.log('✅ Successfully updated profile:', basicInfo.first_name, basicInfo.last_name, `(${updatedCount} rows via ${matchedBy})`)
        } else {
          console.warn('⚠️ No matching profile found for:', basicInfo.first_name, basicInfo.last_name, {
            primary_id: basicInfo.urn,
            secondary_id: basicInfo.public_identifier || enrichedProfile.profileUrl,
            profileUrl: enrichedProfile.profileUrl
          })
        }

        return (updateError || updatedCount === 0) ? null : (basicInfo.urn || enrichedProfile.profileUrl)
      } catch (error) {
        console.error('Error processing enriched profile:', error)
        return null
      }
    })

    const results = await Promise.allSettled(updatePromises)
    const successCount = results.filter(r => r.status === 'fulfilled' && r.value !== null).length

    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
      progress: 90,
      total: 100,
      currentStep: `Updated ${successCount} profiles in database...`,
      profilesProcessed: successCount,
      totalProfiles: profileIdentifiers.length
    })}\n\n`))

    // Check for and handle profile unification
    await handleProfileUnification(supabase, userId, validEnrichedProfiles, controller, encoder)

    // Send completion
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
      progress: 100,
      total: 100,
      currentStep: `Profile enrichment completed! Updated ${successCount} profiles.`,
      profilesProcessed: successCount,
      totalProfiles: profileIdentifiers.length,
      completed: true
    })}\n\n`))

  } catch (error) {
    console.error('Error in processEnrichment:', error)
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      progress: 0,
      total: 100,
      currentStep: 'Error occurred during enrichment'
    })}\n\n`))
  } finally {
    controller.close()
  }
}

async function handleProfileUnification(
  supabase: any,
  userId: string,
  enrichedProfiles: ApifyProfileEnrichmentData[],
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder
) {
  try {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
      progress: 95,
      total: 100,
      currentStep: 'Checking for duplicate profiles...',
      profilesProcessed: enrichedProfiles.length,
      totalProfiles: enrichedProfiles.length
    })}\n\n`))

    // Find potential duplicates by matching public_identifier with URNs
    for (const enrichedProfile of enrichedProfiles) {
      const basicInfo = enrichedProfile.basic_info || {}
      const { public_identifier, urn } = basicInfo

      if (!public_identifier) continue

      // Look for profiles with same public_identifier but different URN
      const { data: duplicates, error } = await supabase
        .from('profiles')
        .select('id, urn, public_identifier, first_seen')
        .or(`public_identifier.eq.${public_identifier},urn.eq.${urn}`)

      if (error || !duplicates || duplicates.length <= 1) continue

      // Group by public_identifier/name to find true duplicates
      const duplicateGroups = new Map<string, typeof duplicates>()
      
      duplicates.forEach(profile => {
        const key = profile.public_identifier || profile.urn
        if (!duplicateGroups.has(key)) {
          duplicateGroups.set(key, [])
        }
        duplicateGroups.get(key)?.push(profile)
      })

      // Merge duplicates (keep oldest, update references, delete newer)
      for (const [key, profileGroup] of duplicateGroups) {
        if (profileGroup.length > 1) {
          // Sort by first_seen (oldest first)
          profileGroup.sort((a, b) => new Date(a.first_seen).getTime() - new Date(b.first_seen).getTime())
          
          const keeperId = profileGroup[0].id
          const duplicateIds = profileGroup.slice(1).map(p => p.id)

          // Update reactions and comments to point to keeper
          await supabase
            .from('reactions')
            .update({ reactor_profile_id: keeperId })
            .in('reactor_profile_id', duplicateIds)

          await supabase
            .from('comments')
            .update({ commenter_profile_id: keeperId })
            .in('commenter_profile_id', duplicateIds)

          // Delete duplicate profiles
          await supabase
            .from('profiles')
            .delete()
            .in('id', duplicateIds)

          console.log(`Merged ${duplicateIds.length} duplicates for ${key}`)
        }
      }
    }
  } catch (error) {
    console.error('Error in profile unification:', error)
    // Don't fail the whole process for unification errors
  }
}
