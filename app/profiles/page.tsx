'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Download, ChevronDown, Copy } from 'lucide-react'
import type { Database } from '@/lib/types/database.types'

type EngagementTimelineItem = {
  post_id: string
  post_url: string
  posted_at_iso: string
  post_text?: string
  author_name?: string
  engagement_types: string[]
  reaction_type?: string
  comment_text?: string
  comment_posted_at?: string
}

type Profile = Database['public']['Tables']['profiles']['Row'] & {
  total_reactions?: number
  total_comments?: number
  posts_reacted_to?: number
  posts_commented_on?: number
  posts_engaged_with?: number
  reaction_types?: string[]
  latest_post_date?: string
  latest_post_url?: string
  posts?: Array<{
    post_id: string
    post_url: string
    engagement_type: 'reaction' | 'comment'
    reaction_type?: string
    comment_text?: string
    created_at: string
  }>
}

export default function ProfilesPage() {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isEnriching, setIsEnriching] = useState(false)
  const [enrichmentProgress, setEnrichmentProgress] = useState<{
    progress: number
    total: number
    currentStep: string
    profilesProcessed: number
    totalProfiles: number
  } | null>(null)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [filteredProfiles, setFilteredProfiles] = useState<Profile[]>([])
  const [paginatedProfiles, setPaginatedProfiles] = useState<Profile[]>([])
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage] = useState(100)
  const [user, setUser] = useState<any>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState<'name' | 'reactions' | 'comments' | 'posts' | 'latest_post' | 'first_seen' | 'last_enriched_at' | 'location' | 'company'>('latest_post')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [showNewProfilesOnly, setShowNewProfilesOnly] = useState(false)
  const [showNeedsEnrichmentOnly, setShowNeedsEnrichmentOnly] = useState(false)
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null)
  const [selectedProfiles, setSelectedProfiles] = useState<Set<string>>(new Set())
  const [timelineDialog, setTimelineDialog] = useState<{
    isOpen: boolean
    profile: Profile | null
    timeline: EngagementTimelineItem[]
    isLoading: boolean
    counts?: { totalPosts: number; totalReactions: number; totalComments: number }
  }>({
    isOpen: false,
    profile: null,
    timeline: [],
    isLoading: false
  })
  const supabase = createClient()

  // Selection management functions
  const toggleProfileSelection = (profileId: string) => {
    const newSelected = new Set(selectedProfiles)
    if (newSelected.has(profileId)) {
      newSelected.delete(profileId)
    } else {
      newSelected.add(profileId)
    }
    setSelectedProfiles(newSelected)
  }

  const selectAllCurrentPage = () => {
    const currentPageIds = new Set(paginatedProfiles.map(p => p.id))
    setSelectedProfiles(currentPageIds)
  }

  const selectAllFiltered = () => {
    const allFilteredIds = new Set(filteredProfiles.map(p => p.id))
    setSelectedProfiles(allFilteredIds)
  }

  const clearSelection = () => {
    setSelectedProfiles(new Set())
  }

  const isAllCurrentPageSelected = paginatedProfiles.length > 0 && 
    paginatedProfiles.every(p => selectedProfiles.has(p.id))

  const isAllFilteredSelected = filteredProfiles.length > 0 && 
    filteredProfiles.every(p => selectedProfiles.has(p.id))

  const isSomeCurrentPageSelected = paginatedProfiles.some(p => selectedProfiles.has(p.id))

  // Copy to Clipboard function (for Google Sheets)
  const copyToClipboard = async () => {
    // Only copy selected profiles
    const profilesToCopy = filteredProfiles.filter(p => selectedProfiles.has(p.id))

    if (profilesToCopy.length === 0) {
      alert('No profiles selected to copy')
      return
    }

    // Prepare data for clipboard in tab-separated format (TSV)
    const headers = [
      'Name',
      'First Name',
      'Last Name',
      'Headline', 
      'Profile URL',
      'URN',
      'First Seen',
      'Last Updated',
      'Last Enriched',
      'Total Reactions',
      'Total Comments',
      'Posts Engaged With',
      'Last Engaged Post URL',
      'Last Engaged Post Date',
      'Current Title',
      'Current Company',
      'Company LinkedIn URL',
      'City',
      'Country',
      'Profile Picture URL'
    ]
    
    const rows = profilesToCopy.map(profile => [
      profile.first_name && profile.last_name 
        ? `${profile.first_name} ${profile.last_name}`
        : profile.name || '',
      profile.first_name || '',
      profile.last_name || '',
      profile.headline || '',
      profile.profile_url || '',
      profile.urn || '',
      profile.first_seen ? new Date(profile.first_seen).toLocaleDateString() : '',
      profile.last_updated ? new Date(profile.last_updated).toLocaleDateString() : '',
      profile.last_enriched_at ? new Date(profile.last_enriched_at).toLocaleDateString() : '',
      String(profile.total_reactions || 0),
      String(profile.total_comments || 0),
      String(profile.posts_engaged_with || 0),
      profile.latest_post_url || '',
      profile.latest_post_date ? new Date(profile.latest_post_date).toLocaleDateString() : '',
      profile.current_title || '',
      profile.current_company || '',
      profile.company_linkedin_url || '',
      profile.city || '',
      profile.country || '',
      profile.profile_picture_url || profile.profile_pictures?.small || ''
    ])

    // Join with tabs for columns and newlines for rows
    const tsvContent = [headers.join('\t'), ...rows.map(row => row.join('\t'))].join('\n')

    try {
      await navigator.clipboard.writeText(tsvContent)
      
      // Show success feedback
      setSuccess(`Copied ${profilesToCopy.length} profiles to clipboard! Ready to paste in Google Sheets.`)
      setTimeout(() => setSuccess(null), 3000)
    } catch (error) {
      console.error('Failed to copy to clipboard:', error)
      setError('Failed to copy to clipboard. Please try the CSV export instead.')
      setTimeout(() => setError(null), 3000)
    }
  }

  // CSV Export function
  const exportToCSV = () => {
    // Export only selected profiles, or all if none selected
    const profilesToExport = selectedProfiles.size > 0 
      ? filteredProfiles.filter(p => selectedProfiles.has(p.id))
      : filteredProfiles

    if (profilesToExport.length === 0) {
      alert('No profiles selected for export')
      return
    }

    // Prepare data for CSV export
    const csvData = profilesToExport.map(profile => {
      return {
        'Name': profile.first_name && profile.last_name 
          ? `${profile.first_name} ${profile.last_name}`
          : profile.name || '',
        'First Name': profile.first_name || '',
        'Last Name': profile.last_name || '',
        'Headline': profile.headline || '',
        'Profile URL': profile.profile_url || '',
        'URN': profile.urn || '',
        'First Seen': profile.first_seen ? new Date(profile.first_seen).toLocaleDateString() : '',
        'Last Updated': profile.last_updated ? new Date(profile.last_updated).toLocaleDateString() : '',
        'Last Enriched': profile.last_enriched_at ? new Date(profile.last_enriched_at).toLocaleDateString() : '',
        'Total Reactions': profile.total_reactions || 0,
        'Total Comments': profile.total_comments || 0,
        'Posts Engaged With': profile.posts_engaged_with || 0,
        'Last Engaged Post URL': profile.latest_post_url || '',
        'Last Engaged Post Date': profile.latest_post_date ? new Date(profile.latest_post_date).toLocaleDateString() : '',
        'Current Title': profile.current_title || '',
        'Current Company': profile.current_company || '',
        'Company LinkedIn URL': profile.company_linkedin_url || '',
        'City': profile.city || '',
        'Country': profile.country || '',
        'Profile Picture URL': profile.profile_picture_url || ''
      }
    })

    // Convert to CSV
    const headers = Object.keys(csvData[0] || {})
    const csvContent = [
      headers.join(','),
      ...csvData.map(row => 
        headers.map(header => {
          const value = row[header] || ''
          // Escape quotes and wrap in quotes if contains comma
          return typeof value === 'string' && (value.includes(',') || value.includes('"')) 
            ? `"${value.replace(/"/g, '""')}"` 
            : value
        }).join(',')
      )
    ].join('\n')

    // Download the CSV
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.setAttribute('href', url)
    const suffix = selectedProfiles.size > 0 ? `-selected-${selectedProfiles.size}` : ''
    link.setAttribute('download', `linkedin-profiles${suffix}-${new Date().toISOString().split('T')[0]}.csv`)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  useEffect(() => {
    loadUser()
  }, [])

  useEffect(() => {
    if (user) {
      loadProfiles()
      loadLastSyncTime()
    }
  }, [user])

  useEffect(() => {
    paginateProfiles()
  }, [filteredProfiles, currentPage])

  useEffect(() => {
    // Reset to page 1 and clear selection when filters change
    setCurrentPage(1)
    setSelectedProfiles(new Set())
  }, [searchTerm, sortBy, sortOrder, showNewProfilesOnly, showNeedsEnrichmentOnly])

  async function loadUser() {
    const { data: { user } } = await supabase.auth.getUser()
    setUser(user)
  }

  async function loadLastSyncTime() {
    if (!user?.id) return
    
    try {
      const { data, error } = await supabase
        .from('user_settings')
        .select('last_sync_time')
        .eq('user_id', user.id)
        .single()
      
      if (error) {
        console.error('Error loading last sync time:', error)
      } else {
        setLastSyncTime(data?.last_sync_time || null)
        console.log('Loaded last sync time:', data?.last_sync_time)
      }
    } catch (error) {
      console.error('Error loading last sync time:', error)
    }
  }

  async function loadProfiles() {
    setIsLoading(true)
    setError(null)
    try {
      if (!user?.id) {
        throw new Error('User not authenticated')
      }

      // Get reactions with profile and post data for the current user
      // Use SAME query pattern as timeline - start from posts table
      const { data: reactionsData, error: reactionsError } = await supabase
        .from('posts')
        .select(`
          id,
          post_id,
          post_url,
          user_id,
          posted_at_iso,
          reactions!inner(
          reaction_type,
          scraped_at,
            reactor_profile_id,
          profiles!inner(
            id,
            urn,
            name,
            headline,
            profile_url,
            first_seen,
            last_updated,
            first_name,
            last_name,
            profile_picture_url,
            profile_pictures,
            country,
            city,
            current_title,
            current_company,
            is_current_position,
            company_linkedin_url,
            public_identifier,
            primary_identifier,
            secondary_identifier,
            enriched_at,
            last_enriched_at
            )
          )
        `)
        .eq('user_id', user.id)
        .not('reactions.profiles.profile_url', 'ilike', '%/company/%')

      if (reactionsError) {
        console.error('Reactions query error:', reactionsError)
        throw reactionsError
      }

      // Get comments with profile and post data for the current user  
      // Use SAME query pattern as timeline - start from posts table
      const { data: commentsData, error: commentsError } = await supabase
        .from('posts')
        .select(`
            id,
            post_id,
            post_url,
            user_id,
          posted_at_iso,
          comments!inner(
            comment_text,
            posted_at_date,
            scraped_at,
            commenter_profile_id,
            profiles!inner(
              id,
              urn,
              name,
              headline,
              profile_url,
              first_seen,
              last_updated,
              first_name,
              last_name,
              profile_picture_url,
              country,
              city,
              current_title,
              current_company,
              is_current_position,
              company_linkedin_url,
              public_identifier,
              primary_identifier,
              secondary_identifier,
              enriched_at,
              last_enriched_at
            )
          )
        `)
        .eq('user_id', user.id)
        .not('comments.profiles.profile_url', 'ilike', '%/company/%')

      if (commentsError) {
        console.error('Comments query error:', commentsError)
        throw commentsError
      }

      console.log('Reactions data:', reactionsData?.length, 'reactions found')
      console.log('Comments data:', commentsData?.length, 'comments found')

      // Transform the data to aggregate by profile - SAME LOGIC AS TIMELINE
      const profilesMap = new Map<string, Profile>()
      
      // For each profile, we need to find unique posts they engaged with
      // Group reactions by profile first (data structure is now different)
      const reactionsByProfile = new Map<string, any[]>()
      reactionsData?.forEach(post => {
        // Each post can have multiple reactions, group by reactor profile
        post.reactions?.forEach(reaction => {
        const profile = reaction.profiles
          if (!profile) return
          
          if (!reactionsByProfile.has(profile.id)) {
            reactionsByProfile.set(profile.id, [])
          }
          reactionsByProfile.get(profile.id)!.push({
            ...reaction,
            post: {
              id: post.id,
              post_id: post.post_id,
              post_url: post.post_url,
              user_id: post.user_id,
              posted_at_iso: post.posted_at_iso
            }
          })
        })
      })
      
      // Group comments by profile (data structure is now different)
      const commentsByProfile = new Map<string, any[]>()
      commentsData?.forEach(post => {
        // Each post can have multiple comments, group by commenter profile
        post.comments?.forEach(comment => {
          const profile = comment.profiles
          if (!profile) return
          
          if (!commentsByProfile.has(profile.id)) {
            commentsByProfile.set(profile.id, [])
          }
          commentsByProfile.get(profile.id)!.push({
            ...comment,
            post: {
              id: post.id,
              post_id: post.post_id,
              post_url: post.post_url,
              user_id: post.user_id,
              posted_at_iso: post.posted_at_iso
            }
          })
        })
      })
      
      // Get all unique profile IDs
      const allProfileIds = new Set([
        ...reactionsByProfile.keys(),
        ...commentsByProfile.keys()
      ])
      
      // Process each profile exactly like timeline logic
      allProfileIds.forEach(profileId => {
        const reactions = reactionsByProfile.get(profileId) || []
        const comments = commentsByProfile.get(profileId) || []
        
        // Get profile info from first available record
        const profile = reactions[0]?.profiles || comments[0]?.profiles
        if (!profile) return
        
        // Create posts map just like timeline - deduplicate by post ID
        const postsMap = new Map()
        
        // Add reacted posts
        reactions.forEach(reaction => {
          const post = reaction.post
          if (!post) return
          
          postsMap.set(post.id, {
            ...post,
            engagement_types: ['reaction'],
            reaction_type: reaction.reaction_type
          })
        })
        
        // Add commented posts (merge if already exists)
        comments.forEach(comment => {
          const post = comment.post
          if (!post) return
          
          const existing = postsMap.get(post.id)
          if (existing) {
            existing.engagement_types.push('comment')
            existing.comment_text = comment.comment_text
          } else {
            postsMap.set(post.id, {
              ...post,
              engagement_types: ['comment'],
              comment_text: comment.comment_text
            })
          }
        })
        
        const uniquePosts = Array.from(postsMap.values())
        
        // Calculate counts exactly like timeline
        const totalPosts = uniquePosts.length
        const totalReactions = uniquePosts.filter(post => post.engagement_types.includes('reaction')).length
        const totalComments = uniquePosts.filter(post => post.engagement_types.includes('comment')).length
        
        // Debug Yoav specifically
        if (profile.name?.includes('Yoav Eitani')) {
          console.log(`🔍 Yoav aggregation: ${totalPosts} posts, ${totalReactions} reactions, ${totalComments} comments`)
          uniquePosts.forEach((post, index) => {
            if (post.engagement_types.includes('reaction')) {
              console.log(`🐛 Yoav reaction post #${index + 1}: ${post.post_url}`)
            }
          })
        }
        
        // Find latest post date
        const latestPostDate = uniquePosts.reduce((latest, post) => {
          if (!post.posted_at_iso) return latest
          return !latest || new Date(post.posted_at_iso) > new Date(latest) 
            ? post.posted_at_iso 
            : latest
        }, null as string | null)
        
        // Find the URL of the most recent engagement
        const latestPost = uniquePosts.reduce((latest, post) => {
          const postDate = post.posted_at_iso ? new Date(post.posted_at_iso) : new Date(0)
          const latestDate = latest ? new Date(latest.posted_at_iso || 0) : new Date(0)
          return postDate > latestDate ? post : latest
        }, null as any)

        // Store in profiles map
        profilesMap.set(profileId, {
          ...profile,
          total_reactions: totalReactions,
          total_comments: totalComments,
          posts_engaged_with: totalPosts,
          latest_post_date: latestPostDate,
          latest_post_url: latestPost?.post_url || null,
          reaction_types: reactions.map(r => r.reaction_type).filter((v, i, a) => a.indexOf(v) === i),
          posts: uniquePosts.map(post => ({
            post_id: post.post_id,
            post_url: post.post_url,
            engagement_type: post.engagement_types.join(','),
            reaction_type: post.reaction_type,
            comment_text: post.comment_text,
            created_at: post.posted_at_iso || ''
          }))
        })
      })

      const profilesArray = Array.from(profilesMap.values())
      
      // Debug Yoav's final counts
      const yoavProfile = profilesArray.find(p => p.name?.includes('Yoav Eitani'))
      if (yoavProfile) {
        console.log(`🐛 Yoav FINAL COUNTS:`, {
          total_reactions: yoavProfile.total_reactions,
          posts_reacted_to: yoavProfile.posts_reacted_to,
          posts_engaged_with: yoavProfile.posts_engaged_with,
          posts_array_length: yoavProfile.posts?.length
        })
      }
      
      console.log('Processed profiles:', profilesArray.length)
      setProfiles(profilesArray)
      
    } catch (error) {
      console.error('Load profiles error:', error)
      setError(error instanceof Error ? error.message : 'Failed to load profiles')
    } finally {
      setIsLoading(false)
    }
  }

  const handleSort = (column: 'name' | 'reactions' | 'comments' | 'posts' | 'latest_post' | 'first_seen' | 'last_enriched_at' | 'location' | 'company') => {
    if (sortBy === column) {
      // Toggle sort order if clicking the same column
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      // Set new column and default to desc for numeric columns, asc for name
      setSortBy(column)
      setSortOrder(column === 'name' ? 'asc' : 'desc')
    }
  }

  // Enrich selected profiles function
  const enrichSelectedProfiles = async () => {
    if (selectedProfiles.size === 0) {
      setError('Please select profiles to enrich')
      return
    }

    setIsEnriching(true)
    setEnrichmentProgress(null)
    setError(null)
    setSuccess(null)

    try {
      const profileIds = Array.from(selectedProfiles)
      
      const response = await fetch('/api/scrape/enrich-profiles-progress', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ profileIds }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to start enrichment')
      }

      if (!response.body) {
        throw new Error('No response body')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              
              if (data.error) {
                throw new Error(data.error)
              }
              
              setEnrichmentProgress(data)
              
              if (data.completed) {
                setSuccess(`Profile enrichment completed! Updated ${data.profilesProcessed} profiles.`)
                // Reload profiles to show enriched data
                setTimeout(() => {
                  loadProfiles()
                }, 1000)
              }
            } catch (parseError) {
              console.error('Error parsing progress data:', parseError)
            }
          }
        }
      }
    } catch (error) {
      console.error('Error enriching profiles:', error)
      setError(error instanceof Error ? error.message : 'Failed to enrich profiles')
    } finally {
      setIsEnriching(false)
      setEnrichmentProgress(null)
    }
  }

  // Helper function to check if a profile is new (discovered since last sync)
  const isNewProfile = useCallback((profile: Profile): boolean => {
    if (!profile.first_seen) return false
    if (!lastSyncTime) return false // No sync recorded yet, so no profiles are "new"
    
    const firstSeenDate = new Date(profile.first_seen)
    const lastSyncDate = new Date(lastSyncTime)
    const timeDifference = firstSeenDate.getTime() - lastSyncDate.getTime()
    
    // Consider profiles "new" if they were created within 5 minutes before sync time
    // This accounts for profiles discovered during the same scraping session
    const SCRAPING_SESSION_WINDOW = 5 * 60 * 1000 // 5 minutes in milliseconds
    const isNew = timeDifference > -SCRAPING_SESSION_WINDOW
    
    return isNew
  }, [lastSyncTime])

  const loadEngagementTimeline = async (profile: Profile) => {
    setTimelineDialog(prev => ({ ...prev, isLoading: true, isOpen: true, profile, counts: undefined }))
    
    try {
      if (!user?.id) {
        throw new Error('User not authenticated')
      }

      console.log('Loading timeline for profile:', profile.id, 'user:', user.id)

      // Get posts where this profile reacted or commented
      const [reactedPosts, commentedPosts] = await Promise.all([
        // Posts where they reacted
        supabase
          .from('posts')
          .select(`
            id,
            post_url,
            posted_at_iso,
            post_text,
            author_name,
            reactions!inner(reaction_type, reactor_profile_id)
          `)
          .eq('user_id', user.id)
          .eq('reactions.reactor_profile_id', profile.id)
          .order('posted_at_iso', { ascending: false }),
        
        // Posts where they commented
        supabase
          .from('posts')
          .select(`
            id,
            post_url,
            posted_at_iso,
            post_text,
            author_name,
            comments!inner(comment_text, posted_at_date, commenter_profile_id)
          `)
          .eq('user_id', user.id)
          .eq('comments.commenter_profile_id', profile.id)
          .order('posted_at_iso', { ascending: false })
      ])

      console.log('Reacted posts:', reactedPosts)
      console.log('Commented posts:', commentedPosts)

      if (reactedPosts.error) throw reactedPosts.error
      if (commentedPosts.error) throw commentedPosts.error

      // Combine and deduplicate posts
      const postsMap = new Map()
      
      // Add reacted posts
      reactedPosts.data?.forEach(post => {
        postsMap.set(post.id, {
          ...post,
          engagement_types: ['reaction'],
          reaction_type: post.reactions[0]?.reaction_type
        })
      })
      
      // Add commented posts (merge if already exists)
      commentedPosts.data?.forEach(post => {
        const existing = postsMap.get(post.id)
        if (existing) {
          existing.engagement_types.push('comment')
          existing.comment_text = post.comments[0]?.comment_text
          existing.comment_posted_at = post.comments[0]?.posted_at_date
        } else {
          postsMap.set(post.id, {
            ...post,
            engagement_types: ['comment'],
            comment_text: post.comments[0]?.comment_text,
            comment_posted_at: post.comments[0]?.posted_at_date
          })
        }
      })

      const postsData = Array.from(postsMap.values()).sort((a, b) => 
        new Date(b.posted_at_iso).getTime() - new Date(a.posted_at_iso).getTime()
      )

      console.log('Combined posts data:', postsData)

      // Transform the data into timeline items
      const timeline: EngagementTimelineItem[] = postsData.map(post => ({
        post_id: post.id,
        post_url: post.post_url,
        posted_at_iso: post.posted_at_iso,
        post_text: post.post_text,
        author_name: post.author_name,
        engagement_types: post.engagement_types,
        reaction_type: post.reaction_type,
        comment_text: post.comment_text,
        comment_posted_at: post.comment_posted_at
      }))

      console.log('Final timeline:', timeline)

      // Calculate counts
      const totalPosts = timeline.length
      const totalReactions = timeline.filter(item => item.engagement_types.includes('reaction')).length
      const totalComments = timeline.filter(item => item.engagement_types.includes('comment')).length

      console.log('Timeline counts:', { totalPosts, totalReactions, totalComments })

      setTimelineDialog(prev => ({ 
        ...prev, 
        timeline, 
        isLoading: false,
        counts: { totalPosts, totalReactions, totalComments }
      }))
    } catch (error) {
      console.error('Error loading engagement timeline:', error)
      setTimelineDialog(prev => ({ 
        ...prev, 
        timeline: [], 
        isLoading: false,
        counts: undefined
      }))
    }
  }

  const getSortValue = useCallback((profile: Profile, column: string) => {
    switch (column) {
      case 'name':
        return profile.name?.toLowerCase() || ''
      case 'reactions':
        return profile.total_reactions || 0
      case 'comments':
        return profile.total_comments || 0
      case 'posts':
        return profile.posts_engaged_with || 0
      case 'latest_post':
        return profile.latest_post_date ? new Date(profile.latest_post_date).getTime() : 0
      case 'first_seen':
        return profile.first_seen ? new Date(profile.first_seen).getTime() : 0
      case 'last_enriched_at':
        return profile.last_enriched_at ? new Date(profile.last_enriched_at).getTime() : 0
      case 'location':
        return [profile.city, profile.country].filter(Boolean).join(', ').toLowerCase()
      case 'company':
        return profile.current_company?.toLowerCase() || ''
      default:
        return 0
    }
  }, [])

  const filterAndSortProfiles = useCallback(() => {
    if (!profiles || profiles.length === 0) {
      setFilteredProfiles([])
      return
    }

    // Start with a copy of all profiles
    let result = [...profiles]

    // Apply search filter
    if (searchTerm.trim()) {
      result = result.filter(profile =>
        profile.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        profile.headline?.toLowerCase().includes(searchTerm.toLowerCase())
      )
    }

    // Apply new profiles filter
    if (showNewProfilesOnly) {
      result = result.filter(profile => isNewProfile(profile))
    }

    // Apply needs enrichment filter
    if (showNeedsEnrichmentOnly) {
      result = result.filter(profile => !profile.first_name || profile.first_name.trim() === '')
    }

    // Apply sorting
    result.sort((a, b) => {
      const valueA = getSortValue(a, sortBy)
      const valueB = getSortValue(b, sortBy)

      let comparison = 0
      
      if (sortBy === 'name' || sortBy === 'location' || sortBy === 'company') {
        // String comparison for text fields
        comparison = (valueA as string).localeCompare(valueB as string)
      } else {
        // Numeric comparison for numeric fields
        comparison = (valueA as number) - (valueB as number)
      }

      // Apply sort order
      return sortOrder === 'asc' ? comparison : -comparison
    })

    setFilteredProfiles(result)
  }, [profiles, searchTerm, sortBy, sortOrder, showNewProfilesOnly, showNeedsEnrichmentOnly, getSortValue, isNewProfile])

  // Effect to trigger filtering and sorting when dependencies change
  useEffect(() => {
    filterAndSortProfiles()
  }, [filterAndSortProfiles])

  function paginateProfiles() {
    const startIndex = (currentPage - 1) * itemsPerPage
    const endIndex = startIndex + itemsPerPage
    const paginated = filteredProfiles.slice(startIndex, endIndex)
    setPaginatedProfiles(paginated)
  }

  const totalPages = Math.ceil(filteredProfiles.length / itemsPerPage)

  if (!user) {
    return (
      <div className="container mx-auto py-8 px-4">
        <div className="max-w-2xl mx-auto text-center">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-200 rounded w-48 mx-auto"></div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Profiles</h1>
            <p className="text-gray-600">People who have engaged with your LinkedIn posts (reactions and comments)</p>
        </div>

        </div>

        {/* Error Message */}
        {error && (
          <Alert variant="destructive" className="mb-6">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Success Message */}
        {success && (
          <Alert className="mb-6 border-green-200 bg-green-50">
            <AlertDescription className="text-green-800">{success}</AlertDescription>
          </Alert>
        )}

        {/* Enrichment Progress */}
        {isEnriching && enrichmentProgress && (
          <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-blue-900">Profile Enrichment</span>
              <span className="text-sm text-blue-700">
                {enrichmentProgress.profilesProcessed} / {enrichmentProgress.totalProfiles} profiles
              </span>
            </div>
            <div className="w-full bg-blue-200 rounded-full h-2 mb-2">
              <div 
                className="bg-blue-600 h-2 rounded-full transition-all duration-300 ease-out" 
                style={{ width: `${enrichmentProgress.progress}%` }}
              ></div>
            </div>
            <p className="text-sm text-blue-800">{enrichmentProgress.currentStep}</p>
          </div>
        )}

        {/* Stats */}
        {!isLoading && profiles.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-6">
            <Card>
              <CardContent className="px-4 py-2">
                <div className="text-2xl font-bold text-blue-600">{profiles.length}</div>
                <div className="text-sm text-gray-600">Total Profiles</div>
              </CardContent>
            </Card>
            <Card 
              className="cursor-pointer transition-all duration-200 hover:shadow-md hover:ring-1 hover:ring-green-300"
              onClick={() => setShowNewProfilesOnly(!showNewProfilesOnly)}
            >
              <CardContent className="px-4 py-2">
                <div className="text-2xl font-bold text-green-600">
                  {profiles.filter(p => isNewProfile(p)).length}
                </div>
                <div className="text-sm text-gray-600">
                  New Profiles (since last sync)
                </div>
              </CardContent>
            </Card>
            <Card 
              className="cursor-pointer transition-all duration-200 hover:shadow-md hover:ring-1 hover:ring-blue-300"
              onClick={() => setShowNeedsEnrichmentOnly(!showNeedsEnrichmentOnly)}
            >
              <CardContent className="px-4 py-2">
                <div className="text-2xl font-bold text-blue-600">
                  {profiles.filter(p => !p.first_name || p.first_name.trim() === '').length}
                </div>
                <div className="text-sm text-gray-600">
                  Needs Enrichment
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="px-4 py-2">
                <div className="text-2xl font-bold text-purple-600">
                  {profiles.reduce((sum, p) => sum + (p.total_reactions || 0), 0)}
                </div>
                <div className="text-sm text-gray-600">Total Reactions</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="px-4 py-2">
                <div className="text-2xl font-bold text-orange-600">
                  {profiles.reduce((sum, p) => sum + (p.total_comments || 0), 0)}
                </div>
                <div className="text-sm text-gray-600">Total Comments</div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Search and Actions Bar */}
        {profiles.length > 0 && (
          <div className="flex items-center justify-between mb-6">
            <Input
              placeholder="Search by name or headline..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-80"
            />
            <div className="flex items-center gap-2">
              {selectedProfiles.size > 0 && (
                <>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={enrichSelectedProfiles}
                    disabled={isEnriching}
                    className="whitespace-nowrap"
                  >
                    {isEnriching ? (
                      <>
                        <div className="h-4 w-4 mr-2 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Enriching...
                      </>
                    ) : (
                      <>
                        <svg className="h-4 w-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        Enrich ({selectedProfiles.size})
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={copyToClipboard}
                    className="whitespace-nowrap"
                  >
                    Copy to Clipboard ({selectedProfiles.size})
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={exportToCSV}
                    className="whitespace-nowrap"
                  >
                    Export CSV ({selectedProfiles.size})
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Profiles Table */}
        <Card>
          <CardContent className="px-3 py-0">

            {/* Top Pagination Controls */}
            {!isLoading && filteredProfiles.length > 0 && (
              <div className="flex items-center justify-between px-4 py-3 border-b">
                <div className="text-sm text-gray-600">
                  {selectedProfiles.size > 0 ? (
                    `${selectedProfiles.size} profile${selectedProfiles.size === 1 ? '' : 's'} selected`
                  ) : (
                    (totalPages > 1 || searchTerm || showNewProfilesOnly || showNeedsEnrichmentOnly) && `Showing ${(currentPage - 1) * itemsPerPage + 1} to ${Math.min(currentPage * itemsPerPage, filteredProfiles.length)} of ${filteredProfiles.length} profiles`
                  )}
                </div>
                <div className="flex-1"></div>
                {totalPages > 1 && (
                  <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(1)}
                    disabled={currentPage === 1}
                  >
                    First
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                  >
                    Previous
                  </Button>
                  <span className="text-sm text-gray-600 px-3">
                    Page {currentPage} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages}
                  >
                    Next
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(totalPages)}
                    disabled={currentPage === totalPages}
                  >
                    Last
                  </Button>
                  </div>
                )}
              </div>
            )}
            
            {isLoading ? (
              <div className="p-3">
                <div className="space-y-4">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="h-16 bg-gray-200 rounded animate-pulse"></div>
                  ))}
                </div>
              </div>
            ) : filteredProfiles.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <p className="text-lg mb-2">
                  {profiles.length === 0 ? 'No profiles found' : 'No profiles match your search'}
                </p>
                <p className="text-sm">
                  {profiles.length === 0 ? 'Scrape some post reactions or comments to see profiles here' : 'Try adjusting your search terms'}
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12 text-center">#</TableHead>
                    <TableHead className="w-12">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <div className="flex items-center cursor-pointer">
                            <Checkbox
                              checked={isAllCurrentPageSelected}
                              ref={(el) => {
                                if (el) {
                                  el.indeterminate = !isAllCurrentPageSelected && isSomeCurrentPageSelected
                                }
                              }}
                              onChange={() => {}}
                            />
                            <ChevronDown className="h-3 w-3 ml-1" />
                          </div>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          <DropdownMenuItem onClick={selectAllCurrentPage}>
                            Select Page ({paginatedProfiles.length})
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={selectAllFiltered}>
                            Select All Filtered ({filteredProfiles.length})
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={clearSelection}>
                            Clear Selection
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableHead>
                    <TableHead 
                      className="cursor-pointer hover:bg-gray-50 select-none"
                      onClick={() => handleSort('name')}
                    >
                      <div className="flex items-center gap-1">
                        Profile
                        {sortBy === 'name' && (
                          <span className="text-xs">
                            {sortOrder === 'asc' ? '↑' : '↓'}
                          </span>
                        )}
                      </div>
                    </TableHead>
                    <TableHead 
                      className="cursor-pointer hover:bg-gray-50 select-none"
                      onClick={() => handleSort('reactions')}
                    >
                      <div className="flex items-center gap-1">
                        Reactions
                        {sortBy === 'reactions' && (
                          <span className="text-xs">
                            {sortOrder === 'asc' ? '↑' : '↓'}
                          </span>
                        )}
                      </div>
                    </TableHead>
                    <TableHead 
                      className="cursor-pointer hover:bg-gray-50 select-none"
                      onClick={() => handleSort('comments')}
                    >
                      <div className="flex items-center gap-1">
                        Comments
                        {sortBy === 'comments' && (
                          <span className="text-xs">
                            {sortOrder === 'asc' ? '↑' : '↓'}
                          </span>
                        )}
                      </div>
                    </TableHead>
                    <TableHead 
                      className="cursor-pointer hover:bg-gray-50 select-none"
                      onClick={() => handleSort('posts')}
                    >
                      <div className="flex items-center gap-1">
                        Posts
                        {sortBy === 'posts' && (
                          <span className="text-xs">
                            {sortOrder === 'asc' ? '↑' : '↓'}
                          </span>
                        )}
                      </div>
                    </TableHead>
                    <TableHead 
                      className="cursor-pointer hover:bg-gray-50 select-none"
                      onClick={() => handleSort('latest_post')}
                    >
                      <div className="flex items-center gap-1">
                        Latest Post
                        {sortBy === 'latest_post' && (
                          <span className="text-xs">
                            {sortOrder === 'asc' ? '↑' : '↓'}
                          </span>
                        )}
                      </div>
                    </TableHead>
                    <TableHead 
                      className="cursor-pointer hover:bg-gray-50 select-none"
                      onClick={() => handleSort('first_seen')}
                    >
                      <div className="flex items-center gap-1">
                        First Seen
                        {sortBy === 'first_seen' && (
                          <span className="text-xs">
                            {sortOrder === 'asc' ? '↑' : '↓'}
                          </span>
                        )}
                      </div>
                    </TableHead>
                    <TableHead 
                      className="cursor-pointer hover:bg-gray-50 select-none"
                      onClick={() => handleSort('last_enriched_at')}
                    >
                      <div className="flex items-center gap-1">
                        Last Enriched
                        {sortBy === 'last_enriched_at' && (
                          <span className="text-xs">
                            {sortOrder === 'asc' ? '↑' : '↓'}
                          </span>
                        )}
                      </div>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedProfiles.map((profile, index) => (
                    <TableRow key={profile.id}>
                      <TableCell className="text-center text-sm text-gray-500 font-mono">
                        {(currentPage - 1) * itemsPerPage + index + 1}
                      </TableCell>
                      <TableCell>
                        <Checkbox
                          checked={selectedProfiles.has(profile.id)}
                          onCheckedChange={() => toggleProfileSelection(profile.id)}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          {/* Profile Picture */}
                          {(() => {
                            const profilePictureUrl = profile.profile_picture_url || 
                              (profile.profile_pictures?.small);
                            
                            return profilePictureUrl ? (
                              <img
                                src={profilePictureUrl}
                                alt={`${profile.first_name || profile.name || 'Unknown'}'s profile`}
                                className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                                onError={(e) => {
                                  e.currentTarget.style.display = 'none'
                                }}
                              />
                            ) : (
                              <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                              <svg className="w-6 h-6 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M24 20.993V24H0v-2.996A14.977 14.977 0 0112.004 15c4.904 0 9.26 2.354 11.996 5.993zM16.002 8.999a4 4 0 11-8 0 4 4 0 018 0z" />
                              </svg>
                            </div>
                            );
                          })()}
                          
                          <div className="flex-1 min-w-0">
                            {/* Name and LinkedIn Link */}
                        {profile.profile_url ? (
                              <div className="flex items-center gap-2">
                          <a
                            href={profile.profile_url}
                            target="_blank"
                            rel="noopener noreferrer"
                                  className="flex items-center gap-1.5 hover:text-blue-600 transition-colors"
                                >
                                  <div className="font-medium text-sm truncate">
                                    {profile.first_name && profile.last_name 
                                      ? `${profile.first_name} ${profile.last_name}`
                                      : profile.name || 'Unknown'
                                    }
                                  </div>
                                  <svg
                                    width="12"
                                    height="12"
                                    viewBox="0 0 24 24"
                                    fill="currentColor"
                                    className="text-blue-600 flex-shrink-0"
                                  >
                                    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                                  </svg>
                                </a>
                                {isNewProfile(profile) && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 border border-green-200 flex-shrink-0">
                                    New
                                  </span>
                                )}
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <div className="font-medium text-sm truncate">
                                  {profile.first_name && profile.last_name 
                                    ? `${profile.first_name} ${profile.last_name}`
                                    : profile.name || 'Unknown'
                                  }
                                </div>
                                {isNewProfile(profile) && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 border border-green-200 flex-shrink-0">
                                    New
                                  </span>
                                )}
                              </div>
                            )}
                            
                            {/* Current Job Title */}
                            {profile.current_title && (
                              <div className="text-xs text-gray-600 truncate mt-1">
                                {profile.current_title}
                              </div>
                            )}
                            
                            {/* Current Company */}
                            {profile.current_company && (
                              <div className="text-xs text-gray-600 truncate mt-0.5">
                                {profile.company_linkedin_url ? (
                                  <a
                                    href={profile.company_linkedin_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 hover:text-blue-800 hover:underline"
                                  >
                                    {profile.current_company}
                                  </a>
                                ) : (
                                  profile.current_company
                                )}
                              </div>
                            )}
                            
                            {/* Location */}
                            {(profile.city || profile.country) && (
                              <div className="text-xs text-gray-500 truncate mt-0.5">
                                📍 {[profile.city, profile.country].filter(Boolean).join(', ')}
                              </div>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm font-medium">
                          {profile.total_reactions || 0}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm font-medium">
                          {profile.total_comments || 0}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          {profile.posts_engaged_with || 0}
                        </div>
                      </TableCell>
                      <TableCell>
                        <button
                          onClick={() => loadEngagementTimeline(profile)}
                          className="text-sm text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                        >
                          {profile.latest_post_date 
                            ? new Date(profile.latest_post_date).toLocaleDateString()
                            : 'Unknown'
                          }
                        </button>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          {profile.first_seen 
                            ? new Date(profile.first_seen).toLocaleDateString()
                            : 'Unknown'
                          }
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          {profile.last_enriched_at 
                            ? new Date(profile.last_enriched_at).toLocaleDateString()
                            : 'Never'
                          }
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            
            {/* Bottom Pagination Controls */}
            {!isLoading && filteredProfiles.length > 0 && totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t">
                <div className="text-sm text-gray-600">
                  {selectedProfiles.size > 0 ? (
                    `${selectedProfiles.size} profile${selectedProfiles.size === 1 ? '' : 's'} selected`
                  ) : (
                    `Showing ${(currentPage - 1) * itemsPerPage + 1} to ${Math.min(currentPage * itemsPerPage, filteredProfiles.length)} of ${filteredProfiles.length} profiles`
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(1)}
                    disabled={currentPage === 1}
                  >
                    First
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                  >
                    Previous
                  </Button>
                  <span className="text-sm text-gray-600 px-3">
                    Page {currentPage} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages}
                  >
                    Next
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(totalPages)}
                    disabled={currentPage === totalPages}
                  >
                    Last
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Engagement Timeline Dialog */}
        <Dialog 
          open={timelineDialog.isOpen} 
          onOpenChange={(open) => setTimelineDialog(prev => ({ ...prev, isOpen: open }))}
        >
          <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
            <DialogHeader className="flex-shrink-0">
              <DialogTitle className="flex items-center gap-2">
                {/* LinkedIn Icon */}
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="text-blue-600"
                >
                  <path
                    d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"
                    fill="currentColor"
                  />
                </svg>
                Engagement Timeline - {timelineDialog.profile?.name || 'Unknown'}
              </DialogTitle>
              {timelineDialog.counts && (
                <div className="flex gap-6 text-sm text-gray-600 mt-2">
                  <div className="flex items-center gap-1">
                    <span className="font-medium">{timelineDialog.counts.totalPosts}</span>
                    <span>Posts</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="font-medium">{timelineDialog.counts.totalReactions}</span>
                    <span>Reactions</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="font-medium">{timelineDialog.counts.totalComments}</span>
                    <span>Comments</span>
                  </div>
                </div>
              )}
            </DialogHeader>
            
            <div className="flex-1 overflow-y-auto min-h-0">
              {timelineDialog.isLoading ? (
                <div className="space-y-4 p-4">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="h-20 bg-gray-200 rounded animate-pulse"></div>
                  ))}
                </div>
              ) : timelineDialog.timeline.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No engagement history found for this profile.
                </div>
              ) : (
                <div className="space-y-4 p-4">
                  {timelineDialog.timeline.map((item, index) => (
                    <div key={item.post_id} className="border rounded-lg p-4 bg-white shadow-sm">
                      {/* Post Header */}
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          {item.author_name && (
                            <span className="text-sm font-medium text-gray-700">
                              by {item.author_name}
                            </span>
                          )}
                          <a
                            href={item.post_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
                          >
                            View on LinkedIn
                          </a>
                        </div>
                        <div className="text-sm text-gray-500">
                          {new Date(item.posted_at_iso).toLocaleDateString()}
                        </div>
                      </div>

                      {/* Post Content */}
                      {item.post_text && (
                        <div className="mb-3 p-3 bg-gray-50 rounded-lg">
                          <div className="text-sm text-gray-800 leading-relaxed">
                            {item.post_text.length > 200 
                              ? `${item.post_text.substring(0, 200)}...` 
                              : item.post_text
                            }
                          </div>
                        </div>
                      )}

                      {/* Engagement Types */}
                      <div className="flex flex-wrap gap-2 mb-3">
                        {item.engagement_types.includes('reaction') && (
                          <Badge variant="outline" className="text-green-600 border-green-300">
                            👍 Reacted {item.reaction_type ? `(${item.reaction_type})` : ''}
                          </Badge>
                        )}
                        {item.engagement_types.includes('comment') && (
                          <Badge variant="outline" className="text-blue-600 border-blue-300">
                            💬 Commented
                          </Badge>
                        )}
                      </div>

                      {/* Comment Details */}
                      {item.comment_text && (
                        <div className="bg-gray-50 rounded p-3 mt-3">
                          <div className="text-sm text-gray-600 mb-1">Comment:</div>
                          <div className="text-sm text-gray-800">{item.comment_text}</div>
                          {item.comment_posted_at && (
                            <div className="text-xs text-gray-500 mt-2">
                              Posted: {new Date(item.comment_posted_at).toLocaleDateString()}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
