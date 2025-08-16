'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
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
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [filteredProfiles, setFilteredProfiles] = useState<Profile[]>([])
  const [user, setUser] = useState<any>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState<'name' | 'reactions' | 'comments' | 'posts' | 'latest_post'>('reactions')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [timelineDialog, setTimelineDialog] = useState<{
    isOpen: boolean
    profile: Profile | null
    timeline: EngagementTimelineItem[]
    isLoading: boolean
  }>({
    isOpen: false,
    profile: null,
    timeline: [],
    isLoading: false
  })
  const supabase = createClient()

  useEffect(() => {
    loadUser()
  }, [])

  useEffect(() => {
    if (user) {
      loadProfiles()
    }
  }, [user])

  useEffect(() => {
    filterAndSortProfiles()
  }, [profiles, searchTerm, sortBy, sortOrder])

  async function loadUser() {
    const { data: { user } } = await supabase.auth.getUser()
    setUser(user)
  }

  async function loadProfiles() {
    setIsLoading(true)
    setError(null)
    try {
      if (!user?.id) {
        throw new Error('User not authenticated')
      }

      // Get reactions with profile and post data for the current user
      const { data: reactionsData, error: reactionsError } = await supabase
        .from('reactions')
        .select(`
          reaction_type,
          scraped_at,
          profiles!inner(
            id,
            urn,
            name,
            headline,
            profile_url,
            first_seen,
            last_updated
          ),
          posts!inner(
            id,
            post_id,
            post_url,
            user_id,
            posted_at_iso
          )
        `)
        .eq('user_id', user.id)

      if (reactionsError) {
        console.error('Reactions query error:', reactionsError)
        throw reactionsError
      }

      // Get comments with profile and post data for the current user
      const { data: commentsData, error: commentsError } = await supabase
        .from('comments')
        .select(`
          comment_text,
          posted_at_date,
          scraped_at,
          profiles!inner(
            id,
            urn,
            name,
            headline,
            profile_url,
            first_seen,
            last_updated
          ),
          posts!inner(
            id,
            post_id,
            post_url,
            user_id,
            posted_at_iso
          )
        `)
        .eq('user_id', user.id)

      if (commentsError) {
        console.error('Comments query error:', commentsError)
        throw commentsError
      }

      console.log('Reactions data:', reactionsData?.length, 'reactions found')
      console.log('Comments data:', commentsData?.length, 'comments found')

      // Transform the data to aggregate by profile
      const profilesMap = new Map<string, Profile>()
      
      // Process reactions
      reactionsData?.forEach(reaction => {
        const profile = reaction.profiles
        const post = reaction.posts
        
        if (!profile || !post) return

        const profileId = profile.id
        
        if (!profilesMap.has(profileId)) {
          profilesMap.set(profileId, {
            ...profile,
            total_reactions: 0,
            total_comments: 0,
            posts_reacted_to: 0,
            posts_commented_on: 0,
            posts_engaged_with: 0,
            reaction_types: [],
            latest_post_date: post.posted_at_iso,
            posts: []
          })
        }

        const aggregatedProfile = profilesMap.get(profileId)!
        
        // Count total reactions
        aggregatedProfile.total_reactions = (aggregatedProfile.total_reactions || 0) + 1
        
        // Track most recent post date (LinkedIn post publishing date)
        if (post.posted_at_iso && (!aggregatedProfile.latest_post_date || new Date(post.posted_at_iso) > new Date(aggregatedProfile.latest_post_date))) {
          aggregatedProfile.latest_post_date = post.posted_at_iso
        }
        
        // Track unique posts (reactions)
        const postExists = aggregatedProfile.posts?.some(p => p.post_id === post.post_id && p.engagement_type === 'reaction')
        if (!postExists) {
          aggregatedProfile.posts?.push({
            post_id: post.post_id,
            post_url: post.post_url,
            engagement_type: 'reaction',
            reaction_type: reaction.reaction_type,
            created_at: post.posted_at_iso || ''
          })
        }
        
        // Track unique reaction types
        if (!aggregatedProfile.reaction_types?.includes(reaction.reaction_type)) {
          aggregatedProfile.reaction_types?.push(reaction.reaction_type)
        }
      })

      // Process comments
      commentsData?.forEach(comment => {
        const profile = comment.profiles
        const post = comment.posts
        
        if (!profile || !post) return

        const profileId = profile.id
        
        if (!profilesMap.has(profileId)) {
          profilesMap.set(profileId, {
            ...profile,
            total_reactions: 0,
            total_comments: 0,
            posts_reacted_to: 0,
            posts_commented_on: 0,
            posts_engaged_with: 0,
            reaction_types: [],
            latest_post_date: post.posted_at_iso,
            posts: []
          })
        }

        const aggregatedProfile = profilesMap.get(profileId)!
        
        // Count total comments
        aggregatedProfile.total_comments = (aggregatedProfile.total_comments || 0) + 1
        
        // Track most recent post date (LinkedIn post publishing date)
        if (post.posted_at_iso && (!aggregatedProfile.latest_post_date || new Date(post.posted_at_iso) > new Date(aggregatedProfile.latest_post_date))) {
          aggregatedProfile.latest_post_date = post.posted_at_iso
        }
        
        // Track unique posts (comments)
        const postExists = aggregatedProfile.posts?.some(p => p.post_id === post.post_id && p.engagement_type === 'comment')
        if (!postExists) {
          aggregatedProfile.posts?.push({
            post_id: post.post_id,
            post_url: post.post_url,
            engagement_type: 'comment',
            comment_text: comment.comment_text,
            created_at: post.posted_at_iso || ''
          })
        }
      })

      // Update aggregated counts
      profilesMap.forEach(profile => {
        const reactionPosts = profile.posts?.filter(p => p.engagement_type === 'reaction') || []
        const commentPosts = profile.posts?.filter(p => p.engagement_type === 'comment') || []
        const uniquePosts = new Set([
          ...reactionPosts.map(p => p.post_id),
          ...commentPosts.map(p => p.post_id)
        ])

        profile.posts_reacted_to = reactionPosts.length
        profile.posts_commented_on = commentPosts.length
        profile.posts_engaged_with = uniquePosts.size
      })

      const profilesArray = Array.from(profilesMap.values())
      console.log('Processed profiles:', profilesArray.length)
      setProfiles(profilesArray)
      
    } catch (error) {
      console.error('Load profiles error:', error)
      setError(error instanceof Error ? error.message : 'Failed to load profiles')
    } finally {
      setIsLoading(false)
    }
  }

  function handleSort(column: 'name' | 'reactions' | 'comments' | 'posts' | 'latest_post') {
    if (sortBy === column) {
      // Toggle sort order if clicking the same column
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      // Set new column and default to desc for numeric columns, asc for name
      setSortBy(column)
      setSortOrder(column === 'name' ? 'asc' : 'desc')
    }
  }

  const loadEngagementTimeline = async (profile: Profile) => {
    setTimelineDialog(prev => ({ ...prev, isLoading: true, isOpen: true, profile }))
    
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

      setTimelineDialog(prev => ({ 
        ...prev, 
        timeline, 
        isLoading: false 
      }))
    } catch (error) {
      console.error('Error loading engagement timeline:', error)
      setTimelineDialog(prev => ({ 
        ...prev, 
        timeline: [], 
        isLoading: false 
      }))
    }
  }

  function filterAndSortProfiles() {
    let filtered = profiles

    // Filter by search term
    if (searchTerm) {
      filtered = filtered.filter(profile =>
        profile.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        profile.headline?.toLowerCase().includes(searchTerm.toLowerCase())
      )
    }

    // Sort profiles
    filtered.sort((a, b) => {
      let comparison = 0
      
      switch (sortBy) {
        case 'name':
          comparison = (a.name || '').localeCompare(b.name || '')
          break
        case 'reactions':
          comparison = (a.total_reactions || 0) - (b.total_reactions || 0)
          break
        case 'comments':
          comparison = (a.total_comments || 0) - (b.total_comments || 0)
          break
        case 'posts':
          comparison = (a.posts_engaged_with || 0) - (b.posts_engaged_with || 0)
          break
        case 'latest_post':
          const dateA = a.latest_post_date ? new Date(a.latest_post_date).getTime() : 0
          const dateB = b.latest_post_date ? new Date(b.latest_post_date).getTime() : 0
          comparison = dateA - dateB
          break
      }

      return sortOrder === 'asc' ? comparison : -comparison
    })

    setFilteredProfiles(filtered)
  }

  if (!user) {
    return (
      <div className="container mx-auto py-8 px-4">
        <div className="max-w-2xl mx-auto text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">
            Please log in to view profiles
          </h1>
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
          <div className="flex-shrink-0">
            <Input
              placeholder="Search by name or headline..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-64"
            />
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <Alert variant="destructive" className="mb-6">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Stats */}
        {!isLoading && profiles.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
            <Card>
              <CardContent className="px-4 py-2">
                <div className="text-2xl font-bold text-blue-600">{profiles.length}</div>
                <div className="text-sm text-gray-600">Total Profiles</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="px-4 py-2">
                <div className="text-2xl font-bold text-green-600">
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

        {/* Profiles Table */}
        <Card>
          <CardContent className="p-3">
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
                    <TableHead>Headline</TableHead>
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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProfiles.map((profile) => (
                    <TableRow key={profile.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {profile.profile_url ? (
                            <>
                              {/* Clickable LinkedIn Icon */}
                              <a
                                href={profile.profile_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:text-blue-800 flex-shrink-0"
                              >
                                <svg
                                  width="16"
                                  height="16"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  xmlns="http://www.w3.org/2000/svg"
                                >
                                  <path
                                    d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"
                                    fill="currentColor"
                                  />
                                </svg>
                              </a>
                              {/* Clickable Profile Name */}
                              <a
                                href={profile.profile_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-medium text-sm text-blue-600 hover:text-blue-800 hover:underline"
                              >
                                {profile.name || 'Unknown'}
                              </a>
                            </>
                          ) : (
                            <>
                              {/* Non-clickable LinkedIn Icon */}
                              <svg
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                xmlns="http://www.w3.org/2000/svg"
                                className="text-gray-400 flex-shrink-0"
                              >
                                <path
                                  d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"
                                  fill="currentColor"
                                />
                              </svg>
                              {/* Non-clickable Profile Name */}
                              <div className="font-medium text-sm">{profile.name || 'Unknown'}</div>
                            </>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm text-gray-600 max-w-xs truncate">
                          {profile.headline || 'No headline'}
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
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
