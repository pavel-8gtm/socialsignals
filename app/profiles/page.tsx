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
import type { Database } from '@/lib/types/database.types'

type Profile = Database['public']['Tables']['profiles']['Row'] & {
  total_reactions?: number
  posts_reacted_to?: number
  reaction_types?: string[]
  last_engaged_date?: string
  posts?: Array<{
    post_id: string
    post_url: string
    reaction_type: string
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
  const [sortBy, setSortBy] = useState<'name' | 'reactions' | 'posts' | 'last_engaged'>('reactions')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
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

      console.log('Reactions data:', reactionsData?.length, 'reactions found')

      // Transform the data to aggregate by profile
      const profilesMap = new Map<string, Profile>()
      
      reactionsData?.forEach(reaction => {
        const profile = reaction.profiles
        const post = reaction.posts
        
        if (!profile || !post) return

        const profileId = profile.id
        
        if (!profilesMap.has(profileId)) {
          profilesMap.set(profileId, {
            ...profile,
            total_reactions: 0,
            posts_reacted_to: 0,
            reaction_types: [],
            last_engaged_date: post.posted_at_iso,
            posts: []
          })
        }

        const aggregatedProfile = profilesMap.get(profileId)!
        
        // Count total reactions
        aggregatedProfile.total_reactions = (aggregatedProfile.total_reactions || 0) + 1
        
        // Track most recent engagement (only use actual LinkedIn post date)
        if (post.posted_at_iso && (!aggregatedProfile.last_engaged_date || new Date(post.posted_at_iso) > new Date(aggregatedProfile.last_engaged_date))) {
          aggregatedProfile.last_engaged_date = post.posted_at_iso
        }
        
        // Track unique posts
        const postExists = aggregatedProfile.posts?.some(p => p.post_id === post.post_id)
        if (!postExists) {
          aggregatedProfile.posts?.push({
            post_id: post.post_id,
            post_url: post.post_url,
            reaction_type: reaction.reaction_type,
            created_at: post.posted_at_iso || ''
          })
        }
        
        // Track unique reaction types
        if (!aggregatedProfile.reaction_types?.includes(reaction.reaction_type)) {
          aggregatedProfile.reaction_types?.push(reaction.reaction_type)
        }
      })

      // Update posts_reacted_to count
      profilesMap.forEach(profile => {
        profile.posts_reacted_to = profile.posts?.length || 0
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
        case 'posts':
          comparison = (a.posts_reacted_to || 0) - (b.posts_reacted_to || 0)
          break
        case 'last_engaged':
          const dateA = a.last_engaged_date ? new Date(a.last_engaged_date).getTime() : 0
          const dateB = b.last_engaged_date ? new Date(b.last_engaged_date).getTime() : 0
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
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Profiles</h1>
          <p className="text-gray-600">People who have reacted to your LinkedIn posts</p>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="flex-1">
            <Input
              placeholder="Search by name or headline..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="max-w-md"
            />
          </div>
          <div className="flex gap-2">
            <Select value={sortBy} onValueChange={(value: 'name' | 'reactions' | 'posts' | 'last_engaged') => setSortBy(value)}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="reactions">Reactions</SelectItem>
                <SelectItem value="posts">Posts</SelectItem>
                <SelectItem value="last_engaged">Last Engaged</SelectItem>
                <SelectItem value="name">Name</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
              className="px-3"
            >
              {sortOrder === 'asc' ? '↑' : '↓'}
            </Button>
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <Card>
              <CardContent className="p-4">
                <div className="text-2xl font-bold text-blue-600">{profiles.length}</div>
                <div className="text-sm text-gray-600">Total Profiles</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-2xl font-bold text-green-600">
                  {profiles.reduce((sum, p) => sum + (p.total_reactions || 0), 0)}
                </div>
                <div className="text-sm text-gray-600">Total Reactions</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-2xl font-bold text-purple-600">
                  {Math.round(profiles.reduce((sum, p) => sum + (p.total_reactions || 0), 0) / profiles.length * 10) / 10}
                </div>
                <div className="text-sm text-gray-600">Avg Reactions/Profile</div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Profiles Table */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6">
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
                  {profiles.length === 0 ? 'Scrape some post reactions to see profiles here' : 'Try adjusting your search terms'}
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Profile</TableHead>
                    <TableHead>Headline</TableHead>
                    <TableHead>Reactions</TableHead>
                    <TableHead>Posts</TableHead>
                    <TableHead>Last Engaged</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProfiles.map((profile) => (
                    <TableRow key={profile.id}>
                      <TableCell>
                        {profile.profile_url ? (
                          <a
                            href={profile.profile_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-sm text-blue-600 hover:text-blue-800 hover:underline"
                          >
                            {profile.name || 'Unknown'}
                          </a>
                        ) : (
                          <div className="font-medium text-sm">{profile.name || 'Unknown'}</div>
                        )}
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
                        <div className="text-sm">
                          {profile.posts_reacted_to || 0}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm text-gray-600">
                          {profile.last_engaged_date 
                            ? new Date(profile.last_engaged_date).toLocaleDateString()
                            : 'Unknown'
                          }
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
