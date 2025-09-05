import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST() {
  try {
    const supabase = await createClient()
    
    // Get the current user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    console.log('🔍 Testing deduplication for Leila Tovbina profiles...')

    // Find Leila Tovbina profiles
    const { data: leilaProfiles, error: findError } = await supabase
      .from('profiles')
      .select('id, urn, public_identifier, secondary_identifier, primary_identifier, first_seen, name, last_enriched_at')
      .or('name.ilike.%Leila Tovbina%,urn.like.%leilatovbina%,public_identifier.like.%leilatovbina%,secondary_identifier.like.%leilatovbina%')

    if (findError) {
      return NextResponse.json({ error: 'Failed to find profiles', details: findError }, { status: 500 })
    }

    console.log('Found Leila profiles:', leilaProfiles)

    if (!leilaProfiles || leilaProfiles.length <= 1) {
      return NextResponse.json({ 
        message: 'No duplicates found', 
        profiles: leilaProfiles 
      })
    }

    // Group profiles that represent the same person
    const duplicateGroups = new Map<string, typeof leilaProfiles>()
    
    leilaProfiles.forEach(profile => {
      // Use public_identifier as the primary key, fallback to secondary_identifier
      const key = profile.public_identifier || profile.secondary_identifier || 'leilatovbina'
      if (!duplicateGroups.has(key)) {
        duplicateGroups.set(key, [])
      }
      duplicateGroups.get(key)?.push(profile)
    })

    // Also check for cross-identifier matches
    for (let i = 0; i < leilaProfiles.length; i++) {
      for (let j = i + 1; j < leilaProfiles.length; j++) {
        const profile1 = leilaProfiles[i]
        const profile2 = leilaProfiles[j]
        
        // Check if they represent the same person with different identifiers
        const identifiers1 = [profile1.public_identifier, profile1.secondary_identifier, profile1.urn].filter(Boolean)
        const identifiers2 = [profile2.public_identifier, profile2.secondary_identifier, profile2.urn].filter(Boolean)
        
        const hasMatchingIdentifier = identifiers1.some(id1 => identifiers2.includes(id1))
        
        if (hasMatchingIdentifier) {
          // Merge them into the same group
          const groupKey = 'leilatovbina'
          if (!duplicateGroups.has(groupKey)) {
            duplicateGroups.set(groupKey, [])
          }
          const group = duplicateGroups.get(groupKey)!
          if (!group.find(p => p.id === profile1.id)) group.push(profile1)
          if (!group.find(p => p.id === profile2.id)) group.push(profile2)
        }
      }
    }

    const results = []

    // Merge duplicates (prefer enriched profiles, then oldest)
    for (const [key, profileGroup] of duplicateGroups) {
      if (profileGroup.length > 1) {
        console.log(`🔄 Merging ${profileGroup.length} duplicate profiles for ${key}`)
        
        // Sort by enrichment status (enriched first), then by first_seen (oldest first)
        profileGroup.sort((a, b) => {
          // Prefer profiles with public_identifier (enriched)
          const aEnriched = !!a.public_identifier
          const bEnriched = !!b.public_identifier
          if (aEnriched !== bEnriched) return bEnriched ? 1 : -1
          
          // Then prefer older profiles
          return new Date(a.first_seen).getTime() - new Date(b.first_seen).getTime()
        })
        
        const keeperId = profileGroup[0].id
        const duplicateIds = profileGroup.slice(1).map(p => p.id)

        console.log(`📌 Keeping profile ${keeperId}, merging: ${duplicateIds.join(', ')}`)

        // Store alternative URNs before deleting
        for (const duplicate of profileGroup.slice(1)) {
          if (duplicate.urn && duplicate.urn !== profileGroup[0].urn) {
            try {
              await supabase.rpc('add_alternative_urn', {
                new_urn: duplicate.urn,
                profile_id: keeperId
              })
              console.log(`✅ Stored alternative URN: ${duplicate.urn} for profile ${keeperId}`)
            } catch (urnError) {
              console.error('Error storing alternative URN:', urnError)
            }
          }
        }

        // Update reactions and comments to point to keeper
        const { error: reactionsError } = await supabase
          .from('reactions')
          .update({ reactor_profile_id: keeperId })
          .in('reactor_profile_id', duplicateIds)

        const { error: commentsError } = await supabase
          .from('comments')
          .update({ commenter_profile_id: keeperId })
          .in('commenter_profile_id', duplicateIds)

        // Delete duplicate profiles
        const { error: deleteError } = await supabase
          .from('profiles')
          .delete()
          .in('id', duplicateIds)

        if (reactionsError || commentsError || deleteError) {
          console.error('Error during merge:', { reactionsError, commentsError, deleteError })
          results.push({
            key,
            status: 'error',
            keeperId,
            duplicateIds,
            errors: { reactionsError, commentsError, deleteError }
          })
        } else {
          console.log(`✅ Successfully merged ${duplicateIds.length} duplicates for ${key}`)
          results.push({
            key,
            status: 'success',
            keeperId,
            duplicateIds,
            mergedCount: duplicateIds.length
          })
        }
      }
    }

    return NextResponse.json({ 
      message: 'Deduplication completed',
      results,
      originalProfiles: leilaProfiles
    })

  } catch (error) {
    console.error('Error in test deduplication:', error)
    return NextResponse.json({ 
      error: 'Internal server error', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 })
  }
}
