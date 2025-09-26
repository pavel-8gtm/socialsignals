'use client'

import React, { useState, useEffect } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import * as z from 'zod'
import { createClient } from '@/lib/supabase/client'
import { validateLinkedInPosts, type LinkedInPostData } from '@/lib/utils/linkedin'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ProgressOverlay, useProgressTracking, type ProgressStep } from '@/components/ui/progress-overlay'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import { ChevronDownIcon, CalendarIcon, Star } from 'lucide-react'
import { format } from 'date-fns'
import type { Database } from '@/lib/types/database.types'

type Post = Database['public']['Tables']['posts']['Row'] & {
  reactions_count?: number
  comments_count?: number
}

const formSchema = z.object({
  postUrls: z.string().min(1, 'Please enter at least one LinkedIn post URL or ID'),
})

const profileFormSchema = z.object({
  profileUrl: z.string().optional().refine((val) => {
    // If provided, must be a valid URL
    return !val || (val.trim().length > 0 && z.string().url().safeParse(val).success)
  }, 'Please enter a valid URL'),
  scrapeUntilDate: z.string().optional(),
  maxPosts: z.string().optional(),
})

export default function PostsPage() {
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [validationResults, setValidationResults] = useState<LinkedInPostData[]>([])
  const [posts, setPosts] = useState<Post[]>([])
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null)
  const [selectedPosts, setSelectedPosts] = useState<Set<string>>(new Set())
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [showProfileDialog, setShowProfileDialog] = useState(false)
  const [isScrapingProfile, setIsScrapingProfile] = useState(false)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [monitoredProfiles, setMonitoredProfiles] = useState<string[]>([])
  const [selectedMonitoredProfiles, setSelectedMonitoredProfiles] = useState<Set<string>>(new Set())
  const [recentlyAddedPosts, setRecentlyAddedPosts] = useState<Set<string>>(new Set())
  const [showStarredOnly, setShowStarredOnly] = useState(false)
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage] = useState(50) // 50 posts per page
  
  // Progress tracking
  const progressTracking = useProgressTracking()
  const [confirmAction, setConfirmAction] = useState<'metadata' | 'reactions' | 'comments' | 'delete' | null>(null)
  
  // Helper function to poll progress (currently unused)
  /*
  const pollProgress = async (progressId: string, endpoint: string, skipLoadPosts = false) => {
    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`${endpoint}?progressId=${progressId}`)
        const data = await response.json()
        
        if (!response.ok) {
          throw new Error(data.error || 'Failed to get progress')
        }
        
        progressTracking.updateProgress(data.progress, data.processedPosts || data.processedItems)
        
        // Update steps based on status
        const steps: ProgressStep[] = [
          {
            id: 'init',
            label: 'Initializing...',
            status: data.progress > 0 ? 'completed' : 'pending'
          },
          {
            id: 'scraping',
            label: data.status === 'scraping' ? 'Scraping data...' : 'Scrape data',
            status: data.status === 'scraping' ? 'running' : data.progress > 20 ? 'completed' : 'pending',
            details: data.currentStep
          },
          {
            id: 'processing',
            label: data.status === 'processing' ? 'Processing results...' : 'Process results',
            status: data.status === 'processing' ? 'running' : data.progress > 70 ? 'completed' : 'pending'
          },
          {
            id: 'saving',
            label: data.status === 'saving' ? 'Saving to database...' : 'Save to database',
            status: data.status === 'saving' ? 'running' : data.progress > 90 ? 'completed' : 'pending'
          }
        ]

        // 🌟 NEW: Add auto-enrichment step when enrichment is detected
        const isEnrichmentStep = data.currentStep && (
          data.currentStep.includes('enrichment') || 
          data.currentStep.includes('Enrichment') ||
          data.currentStep.includes('profiles needing enrichment') ||
          data.currentStep.includes('Auto-enriched')
        )
        
        if (isEnrichmentStep || data.progress >= 91) {
          // Insert enrichment step before the last step (saving/completing)
          const enrichmentStep: ProgressStep = {
            id: 'enrichment',
            label: isEnrichmentStep && data.progress < 100 ? 'Auto-enriching profiles...' : 'Auto-enrich profiles',
            status: isEnrichmentStep && data.progress < 100 ? 'running' : data.progress >= 98 ? 'completed' : 'pending',
            details: isEnrichmentStep ? data.currentStep : undefined
          }
          
          // Insert enrichment step before the last step
          steps.splice(-1, 0, enrichmentStep)
        }
        
        if (data.status === 'error') {
          steps.forEach(step => {
            if (step.status === 'running') {
              step.status = 'error'
              step.errorMessage = data.error
            }
          })
        }
        
        // Update steps in progress tracking
        steps.forEach(step => {
          progressTracking.updateStep(step.id, step)
        })
        
        if (data.status === 'completed' || data.status === 'error') {
          clearInterval(pollInterval)
          progressTracking.completeProgress()
          
          if (data.status === 'completed') {
            // Show a more accurate success message and count newly added posts
            let successMessage = data.result?.message || 'Operation completed successfully'
            if (!skipLoadPosts) {
              const newPostsCount = await loadPosts(true) // Reload posts and detect new ones
              
              // Update success message with actual count of new posts if available
              if (newPostsCount > 0) {
                successMessage = `Successfully added ${newPostsCount} new post${newPostsCount === 1 ? '' : 's'}`
              } else if (successMessage.includes('No posts found')) {
                successMessage = 'Profile scraping completed - no new posts found'
              }
            }
            setSuccess(successMessage)
          } else {
            setError(data.error || 'Operation failed')
          }
        }
      } catch (error) {
        clearInterval(pollInterval)
        progressTracking.updateStep('scraping', {
          id: 'scraping',
          label: 'Error occurred',
          status: 'error',
          errorMessage: error instanceof Error ? error.message : 'Unknown error'
        })
        progressTracking.completeProgress()
        setError(error instanceof Error ? error.message : 'Failed to get progress')
      }
    }, 1000) // Poll every second
    
    return pollInterval
  }
  */
  const [previewPost, setPreviewPost] = useState<Post | null>(null)
  const [showPreviewDialog, setShowPreviewDialog] = useState(false)
  const [showEngagementDialog, setShowEngagementDialog] = useState(false)
  const [engagementData, setEngagementData] = useState<{ post: Post; type: 'reactions' | 'comments'; profiles: Array<Record<string, unknown>> } | null>(null)
  const [loadingEngagement, setLoadingEngagement] = useState(false)
  const [sortBy, setSortBy] = useState<'posted_at' | 'author_name' | 'scraped_at' | 'created_at' | 'metadata_last_updated_at' | null>('posted_at')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [showNeedingScrapingOnly, setShowNeedingScrapingOnly] = useState(false)
  const [authorFilter, setAuthorFilter] = useState('')
  const supabase = createClient()

  // Helper function to get all profiles involved in scraped posts
  async function getProfilesFromScrapedPosts(postIds: string[]): Promise<string[]> {
    try {
      // Get all reactor and commenter profile IDs from the scraped posts
      const [reactionsResult, commentsResult] = await Promise.all([
        supabase
          .from('reactions')
          .select('reactor_profile_id')
          .in('post_id', postIds)
          .eq('user_id', user?.id),
        supabase
          .from('comments')
          .select('commenter_profile_id')
          .in('post_id', postIds)
          .eq('user_id', user?.id)
      ])

      const profileIds = new Set<string>()
      
      reactionsResult.data?.forEach(r => {
        if (r.reactor_profile_id) profileIds.add(r.reactor_profile_id)
      })
      
      commentsResult.data?.forEach(c => {
        if (c.commenter_profile_id) profileIds.add(c.commenter_profile_id)
      })

      return Array.from(profileIds)
    } catch (error) {
      console.error('Error getting profiles from scraped posts:', error)
      return []
    }
  }

  // Enhanced enrichment function that includes existing profiles missing identifiers
  async function performEnhancedEnrichment(
    postIds: string[], 
    newProfileIds: string[] = [], 
    session: any,
    progressTracking: any
  ): Promise<string> {
    let enrichmentMessage = ''
    progressTracking.updateStep('enrichment', { 
      id: 'enrichment', 
      label: 'Finding profiles to enrich...', 
      status: 'running' 
    })

    try {
      // Get all profiles that need enrichment (not just from scraped posts)
      const { data: profilesToEnrich, error: profilesError } = await supabase
        .from('profiles')
        .select('id')
        .or('public_identifier.is.null,secondary_identifier.is.null')

      if (profilesError) {
        console.warn('Error finding profiles to enrich:', profilesError)
        throw new Error('Failed to find profiles for enrichment')
      }

      // Combine new profiles from scraping + all existing profiles missing identifiers
      const allProfilesToEnrich = new Set([
        ...newProfileIds,
        ...(profilesToEnrich?.map(p => p.id) || [])
      ])

      if (allProfilesToEnrich.size > 0) {
        progressTracking.updateStep('enrichment', { 
          id: 'enrichment', 
          label: `Enriching ${allProfilesToEnrich.size} profiles...`, 
          status: 'running' 
        })

        const enrichResponse = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/enrich-profiles-batch`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ profileIds: Array.from(allProfilesToEnrich) }),
        })

        if (enrichResponse.ok) {
          const enrichResult = await enrichResponse.json()
          const newProfiles = newProfileIds.length
          const existingProfiles = allProfilesToEnrich.size - newProfileIds.length
          enrichmentMessage = ` • Enriched ${enrichResult.profilesEnriched || 0} of ${allProfilesToEnrich.size} profiles (${newProfiles} new, ${existingProfiles} existing)`
          progressTracking.updateStep('enrichment', { 
            id: 'enrichment', 
            label: `Enriched ${enrichResult.profilesEnriched || 0} of ${allProfilesToEnrich.size} profiles`, 
            status: 'completed' 
          })
        } else {
          const errorText = await enrichResponse.text()
          console.warn('Profile enrichment failed:', errorText)
          progressTracking.updateStep('enrichment', { 
            id: 'enrichment', 
            label: 'Enrichment failed', 
            status: 'error' 
          })
          enrichmentMessage = ` • ${allProfilesToEnrich.size} profiles found but enrichment failed`
        }
      } else {
        progressTracking.updateStep('enrichment', { 
          id: 'enrichment', 
          label: 'No profiles need enrichment', 
          status: 'completed' 
        })
        enrichmentMessage = ' • All profiles already enriched'
      }
    } catch (enrichError) {
      console.warn('Profile enrichment error:', enrichError)
      progressTracking.updateStep('enrichment', { 
        id: 'enrichment', 
        label: 'Enrichment failed', 
        status: 'error' 
      })
      enrichmentMessage = ' • Profile enrichment failed'
    }

    return enrichmentMessage
  }

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      postUrls: '',
    },
  })

  const profileForm = useForm<z.infer<typeof profileFormSchema>>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: {
      profileUrl: '',
      scrapeUntilDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 7 days ago
      maxPosts: '',
    },
  })

  useEffect(() => {
    async function initializeData() {
      await loadUser()
      await loadPosts()
      await loadMonitoredProfiles()
    }
    initializeData()
  }, [])

  async function loadMonitoredProfiles() {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data, error } = await supabase
        .from('user_settings')
        .select('monitored_profiles')
        .eq('user_id', user.id)
        .single()

      if (!error && data?.monitored_profiles) {
        setMonitoredProfiles(data.monitored_profiles)
        // Pre-select all monitored profiles by default
        setSelectedMonitoredProfiles(new Set(data.monitored_profiles))
      }
    } catch (error) {
      console.warn('Failed to load monitored profiles:', error)
      // Don't show error to user, this is non-critical
    }
  }

  async function loadUser() {
    const { data: { user } } = await supabase.auth.getUser()
    setUser(user)
    return user
  }

  async function loadPosts(detectNewPosts = false) {
    setIsLoading(true)
    try {
      // Get fresh user data to ensure we have the latest authentication state
      const { data: { user: currentUser } } = await supabase.auth.getUser()
      
      if (!currentUser?.id) {
        setIsLoading(false)
        return 0
      }

      const previousPostIds = detectNewPosts ? new Set(posts.map(p => p.id)) : new Set()
      
      // Query posts for the current user
      const { data, error } = await supabase
        .from('posts')
        .select(`
          *,
          reactions_count:reactions(count),
          comments_count:comments(count)
        `)
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false })

      if (error) {
        setError(`Failed to load posts: ${error.message}`)
        return 0
      } else {
        // Transform the data to include counts
        const postsWithCounts = (data || []).map(post => ({
          ...post,
          reactions_count: post.reactions_count?.[0]?.count || 0,
          comments_count: post.comments_count?.[0]?.count || 0
        }))
        
        let newPostsCount = 0
        
        // Detect newly added posts
        if (detectNewPosts) {
          const newPostIds = new Set<string>()
          postsWithCounts.forEach(post => {
            if (!previousPostIds.has(post.id)) {
              newPostIds.add(post.id)
            }
          })
          newPostsCount = newPostIds.size
          setRecentlyAddedPosts(newPostIds)
          
          // Clear the "new" indicators after 10 seconds
          if (newPostIds.size > 0) {
            setTimeout(() => {
              setRecentlyAddedPosts(new Set())
            }, 10000)
          }
        }
        
        setPosts(postsWithCounts)
        return newPostsCount
      }
    } catch {
      setError('Failed to load posts')
      return 0
    } finally {
      setIsLoading(false)
    }
  }

  async function togglePostStar(postId: string) {
    try {
      const post = posts.find(p => p.id === postId)
      if (!post) return

      const newStarredValue = !post.starred
      
      const { error } = await supabase
        .from('posts')
        .update({ starred: newStarredValue })
        .eq('id', postId)

      if (error) {
        setError(error.message)
      } else {
        // Update the local state
        setPosts(prevPosts => 
          prevPosts.map(p => 
            p.id === postId ? { ...p, starred: newStarredValue } : p
          )
        )
      }
    } catch {
      setError('Failed to update post star status')
    }
  }

  async function deleteSelectedPosts() {
    try {
      const { error } = await supabase
        .from('posts')
        .delete()
        .in('id', Array.from(selectedPosts))

      if (error) {
        setError(error.message)
      } else {
        setSuccess(`${selectedPosts.size} post${selectedPosts.size !== 1 ? 's' : ''} deleted successfully`)
        setSelectedPosts(new Set())
        setLastSelectedIndex(null)
        await loadPosts()
      }
    } catch {
      setError('Failed to delete posts')
    }
  }

  function togglePostSelection(postId: string, index?: number, shiftKey?: boolean) {
    const newSelection = new Set(selectedPosts)
    
    // Handle shift-click range selection
    if (shiftKey && lastSelectedIndex !== null && index !== undefined) {
      const startIndex = Math.min(lastSelectedIndex, index)
      const endIndex = Math.max(lastSelectedIndex, index)
      
      // Get the posts in the current filtered and sorted view
      const currentPosts = filteredAndSortedPosts
      
      // Select all posts in the range
      for (let i = startIndex; i <= endIndex; i++) {
        if (i < currentPosts.length) {
          newSelection.add(currentPosts[i].id)
        }
      }
    } else {
      // Normal toggle behavior
      if (newSelection.has(postId)) {
        newSelection.delete(postId)
      } else {
        newSelection.add(postId)
      }
      
      // Update last selected index for future shift-clicks
      if (index !== undefined) {
        setLastSelectedIndex(index)
      }
    }
    
    setSelectedPosts(newSelection)
  }

  function toggleSelectAll() {
    // Get the currently filtered posts
    const filteredPosts = filteredAndSortedPosts
    const filteredIds = filteredPosts.map(post => post.id)
    
    // Check if all filtered posts are selected
    const allFilteredSelected = filteredIds.every(id => selectedPosts.has(id))
    
    if (allFilteredSelected && filteredPosts.length > 0) {
      // Deselect all filtered posts
      const newSelected = new Set(selectedPosts)
      filteredIds.forEach(id => newSelected.delete(id))
      setSelectedPosts(newSelected)
      setLastSelectedIndex(null)
    } else {
      // Select all filtered posts (keeping any existing selections from other filters)
      const newSelected = new Set(selectedPosts)
      filteredIds.forEach(id => newSelected.add(id))
      setSelectedPosts(newSelected)
      setLastSelectedIndex(null)
    }
  }

  function handleAction(action: 'metadata' | 'reactions' | 'comments' | 'delete') {
    setConfirmAction(action)
    setShowConfirmDialog(true)
  }

  async function confirmActionHandler() {
    if (confirmAction === 'delete') {
      deleteSelectedPosts()
    } else if (confirmAction === 'metadata') {
      await fetchMetadata()
    } else if (confirmAction === 'reactions') {
      await scrapeReactions()
    } else if (confirmAction === 'comments') {
      await scrapeComments()
    }
    setShowConfirmDialog(false)
    setConfirmAction(null)
  }

  async function clearEngagementFlagsForPosts(postIds: string[]) {
    if (postIds.length === 0) return

    try {
      const response = await fetch('/api/clear-engagement-flags', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          postIds: postIds
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        console.error('Failed to clear engagement flags:', data.error)
        // Don't throw error here to avoid interrupting the main scraping flow
      }
    } catch (error) {
      console.error('Error clearing engagement flags:', error)
      // Don't throw error here to avoid interrupting the main scraping flow
    }
  }

  async function scrapeBothEngagements() {
    setIsSaving(true)
    setError(null)
    
    try {
      const postIds = Array.from(selectedPosts)
      // const totalPosts = selectedPosts.size

      // Start progress tracking
      const initialSteps: ProgressStep[] = [
        { id: 'init', label: 'Initializing...', status: 'pending' },
        { id: 'reactions', label: 'Scrape reactions', status: 'pending' },
        { id: 'comments', label: 'Scrape comments', status: 'pending' },
        { id: 'enrichment', label: 'Auto-enrich profiles', status: 'pending' },
        { id: 'saving', label: 'Finalizing results', status: 'pending' }
      ]
      
      progressTracking.startProgress('Scraping Reactions & Comments', initialSteps) // Don't show misleading item count
      progressTracking.updateStep('init', { id: 'init', label: 'Starting Edge Functions...', status: 'running' })

      // Get auth token for Edge Functions
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        throw new Error('No authentication session found')
      }

      progressTracking.updateStep('init', { id: 'init', label: 'Authentication verified', status: 'completed' })
      progressTracking.updateProgress(10)

      // 🔧 FIXED: Run Edge Functions sequentially to avoid database conflicts
      progressTracking.updateStep('reactions', { id: 'reactions', label: 'Scraping reactions...', status: 'running' })

      // First: Scrape reactions
      const reactionsResponse = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/scrape-reactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ postIds }),
      })

      // Process reactions result first
      let reactionsSuccess = false
      let reactionsData: { 
        success?: boolean; 
        totalReactions?: number; 
        message?: string;
        autoEnrichment?: {
          profilesEnriched: number;
          newProfilesFound: number;
          enrichmentErrors: string[];
        }
      } | null = null

      if (reactionsResponse.ok) {
        reactionsData = await reactionsResponse.json()
        reactionsSuccess = reactionsData?.success || false
        progressTracking.updateStep('reactions', { 
          id: 'reactions', 
          label: `Reactions completed (${reactionsData?.totalReactions || 0} found)`, 
          status: 'completed' 
        })
      } else {
        const errorText = await reactionsResponse.text()
        progressTracking.updateStep('reactions', { 
          id: 'reactions', 
          label: 'Reactions failed', 
          status: 'error', 
          errorMessage: errorText 
        })
      }

      // Second: Scrape comments (after reactions complete)
      progressTracking.updateStep('comments', { id: 'comments', label: 'Scraping comments...', status: 'running' })

      const commentsResponse = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/scrape-comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ postIds }),
      })

      // Process comments result
      let commentsSuccess = false
      let commentsData: { 
        success?: boolean; 
        totalComments?: number; 
        message?: string;
        autoEnrichment?: {
          profilesEnriched: number;
          newProfilesFound: number;
          enrichmentErrors: string[];
        }
      } | null = null

      if (commentsResponse.ok) {
        commentsData = await commentsResponse.json()
        commentsSuccess = commentsData?.success || false
        progressTracking.updateStep('comments', { 
          id: 'comments', 
          label: `Comments completed (${commentsData?.totalComments || 0} found)`, 
          status: 'completed' 
        })
      } else {
        const errorText = await commentsResponse.text()
        progressTracking.updateStep('comments', { 
          id: 'comments', 
          label: 'Comments failed', 
          status: 'error', 
          errorMessage: errorText 
        })
      }
      
      // 🆕 ENHANCED: Perform comprehensive auto-enrichment after both scraping operations
      const enrichmentMessage = await performEnhancedEnrichment(
        postIds,
        [], // No specific new profiles since individual functions already handled them
        session,
        progressTracking
      )
      
      progressTracking.updateStep('saving', { id: 'saving', label: 'Finalizing...', status: 'running' })
      progressTracking.updateProgress(90)

      // Clear engagement flags for successfully scraped posts
      await clearEngagementFlagsForPosts(postIds)

      progressTracking.updateStep('saving', { id: 'saving', label: 'Completed', status: 'completed' })
      progressTracking.updateProgress(100)
      progressTracking.completeProgress()

      // Set appropriate success/error message with detailed stats
      if (reactionsSuccess && commentsSuccess) {
        const totalEngagement = (reactionsData?.totalReactions || 0) + (commentsData?.totalComments || 0)
        setSuccess(`Successfully scraped ${reactionsData?.totalReactions || 0} reactions and ${commentsData?.totalComments || 0} comments (${totalEngagement} total) for ${selectedPosts.size} posts${enrichmentMessage}`)
      } else if (reactionsSuccess || commentsSuccess) {
        const scraped = reactionsSuccess ? 'reactions' : 'comments'
        const failed = reactionsSuccess ? 'comments' : 'reactions'
        const scrapedCount = reactionsSuccess ? reactionsData?.totalReactions : commentsData?.totalComments
        setSuccess(`Successfully scraped ${scrapedCount || 0} ${scraped} for ${selectedPosts.size} posts. ${failed} scraping had issues.${enrichmentMessage}`)
      } else {
        setError(`Failed to scrape engagements for ${selectedPosts.size} posts. Check the logs for details.`)
      }
      
      setSelectedPosts(new Set()) // Clear selection
      setLastSelectedIndex(null)
      await loadPosts() // Reload posts to show updated data
      
    } catch (error) {
      console.error('Error scraping engagements:', error)
      progressTracking.updateStep('saving', { id: 'saving', label: 'Error occurred', status: 'error', errorMessage: error instanceof Error ? error.message : 'Unknown error' })
      progressTracking.completeProgress()
      setError('Failed to scrape engagements')
    } finally {
      setIsSaving(false)
    }
  }

  async function scrapeComments() {
    setIsSaving(true)
    setError(null)
    
    try {
      const postIds = Array.from(selectedPosts)
      
      // Start progress tracking for comments
      const initialSteps: ProgressStep[] = [
        { id: 'init', label: 'Initializing...', status: 'pending' },
        { id: 'scraping', label: 'Scrape comments', status: 'pending' },
        { id: 'processing', label: 'Process results', status: 'pending' },
        { id: 'saving', label: 'Save to database', status: 'pending' },
        { id: 'enrichment', label: 'Enrich profiles', status: 'pending' }
      ]
      
      // FIXED: Don't pass totalItems to avoid misleading "0 of X items processed"
      progressTracking.startProgress('Scraping Comments', initialSteps)
      progressTracking.updateStep('init', { id: 'init', label: 'Starting comments scraping...', status: 'running' })

      // Get auth token for Edge Functions
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        throw new Error('No authentication session found')
      }

      progressTracking.updateStep('init', { id: 'init', label: 'Authentication verified', status: 'completed' })
      progressTracking.updateStep('scraping', { id: 'scraping', label: 'Scraping comments...', status: 'running' })

      // Call Edge Function directly
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/scrape-comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ postIds }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        progressTracking.updateStep('scraping', {
          id: 'scraping',
          label: 'Failed to scrape comments',
          status: 'error',
          errorMessage: errorText
        })
        progressTracking.completeProgress()
        throw new Error(errorText || 'Failed to scrape comments')
      }

      const result = await response.json()
      
      // ENHANCED: Show detailed stats with new comments info
      const newCommentsText = result.newComments > 0 ? ` (${result.newComments} new)` : ''
      const statsMessage = `Found ${result.totalComments || 0} comments for ${result.processedPosts || postIds.length} posts${newCommentsText}`
      
      progressTracking.updateStep('scraping', { 
        id: 'scraping', 
        label: `Comments completed • ${statsMessage}`, 
        status: 'completed' 
      })
      progressTracking.updateStep('processing', { id: 'processing', label: 'Completed', status: 'completed' })
      progressTracking.updateStep('saving', { id: 'saving', label: 'Completed', status: 'completed' })

      // 🆕 ENHANCED: Auto-enrich profiles (new + existing missing public_identifier)
      const enrichmentMessage = await performEnhancedEnrichment(
        postIds,
        result.profiles?.profileIds || [],
        session,
        progressTracking
      )

      progressTracking.updateProgress(100)
      progressTracking.completeProgress()
      
      // Show success message with stats
      setSuccess(`Comments scraping completed! ${statsMessage}${enrichmentMessage}`)
      
      // Reload posts to show updated data
      await loadPosts()
      
      // Clear selection after successful completion
      setSelectedPosts(new Set())
      setLastSelectedIndex(null)
      
    } catch (error) {
      console.error('Error scraping comments:', error)
      setError('Failed to scrape comments')
    } finally {
      setIsSaving(false)
    }
  }

  async function loadEngagementData(post: Post, type: 'reactions' | 'comments') {
    setLoadingEngagement(true)
    try {
      if (type === 'reactions') {
        const { data, error } = await supabase
          .from('reactions')
          .select(`
            id,
            reaction_type,
            scraped_at,
            profiles!inner(
              id,
              name,
              headline,
              profile_url,
              profile_pictures,
              profile_picture_url
            )
          `)
          .eq('post_id', post.id)
          .order('scraped_at', { ascending: false })

        if (error) throw error
        
        // Deduplicate profiles for reactions - show unique people only
        const uniqueProfiles = new Map()
        data?.forEach(item => {
          const profileId = (item.profiles as unknown as Record<string, unknown>)?.id as string
          if (profileId && !uniqueProfiles.has(profileId)) {
            uniqueProfiles.set(profileId, item)
          }
        })
        
        setEngagementData({ post, type, profiles: Array.from(uniqueProfiles.values()) })
      } else {
        const { data, error } = await supabase
          .from('comments')
          .select(`
            id,
            comment_text,
            posted_at_date,
            scraped_at,
            profiles!inner(
              id,
              name,
              headline,
              profile_url,
              profile_pictures,
              profile_picture_url
            )
          `)
          .eq('post_id', post.id)
          .order('scraped_at', { ascending: false })

        if (error) throw error
        
        // Deduplicate profiles for comments - show unique people only
        const uniqueProfiles = new Map()
        data?.forEach(item => {
          const profileId = (item.profiles as unknown as Record<string, unknown>)?.id as string
          if (profileId && !uniqueProfiles.has(profileId)) {
            uniqueProfiles.set(profileId, item)
          }
        })
        
        setEngagementData({ post, type, profiles: Array.from(uniqueProfiles.values()) })
      }
      
      setShowEngagementDialog(true)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to load engagement data')
    } finally {
      setLoadingEngagement(false)
    }
  }

  async function fetchMetadata() {
    try {
      const postIds = Array.from(selectedPosts)
      
      // Start progress tracking for metadata fetching
      const initialSteps: ProgressStep[] = [
        { id: 'init', label: 'Initializing...', status: 'pending' },
        { id: 'scraping', label: 'Fetch metadata', status: 'pending' },
        { id: 'processing', label: 'Process results', status: 'pending' },
        { id: 'saving', label: 'Save to database', status: 'pending' }
      ]
      
      progressTracking.startProgress('Fetching Post Metadata', initialSteps) // Don't show misleading item count
      progressTracking.updateStep('init', { id: 'init', label: 'Starting metadata scraping...', status: 'running' })

      // Get auth token for Edge Functions
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        throw new Error('No authentication session found')
      }

      progressTracking.updateStep('init', { id: 'init', label: 'Authentication verified', status: 'completed' })
      progressTracking.updateStep('scraping', { id: 'scraping', label: 'Fetching metadata...', status: 'running' })

      // Call Edge Function directly
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/scrape-metadata`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          postIds: postIds,
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        progressTracking.updateStep('scraping', {
          id: 'scraping',
          label: 'Failed to fetch metadata',
          status: 'error',
          errorMessage: errorText
        })
        progressTracking.completeProgress()
        throw new Error(errorText || 'Failed to fetch metadata')
      }

      const result = await response.json()
      
      // Show detailed stats about what was found and what needs re-scraping
      const engagementChanges = result.postsWithEngagementChanges || 0
      const totalPosts = result.processedPosts || 0
      
      let statsMessage = `Metadata completed (${totalPosts} posts processed)`
      if (engagementChanges > 0) {
        statsMessage += ` • ${engagementChanges} posts have engagement changes and need re-scraping`
      }
      
      progressTracking.updateStep('scraping', { 
        id: 'scraping', 
        label: statsMessage,
        status: 'completed' 
      })
      progressTracking.updateStep('processing', { id: 'processing', label: 'Completed', status: 'completed' })
      progressTracking.updateStep('saving', { id: 'saving', label: 'Completed', status: 'completed' })
      progressTracking.updateProgress(100)
      progressTracking.completeProgress()
      
      // Clear selection after successful completion
      setSelectedPosts(new Set())
      setLastSelectedIndex(null)
      await loadPosts() // Refresh the UI to show updated metadata
      
      // Show success message with engagement stats
      if (engagementChanges > 0) {
        setSuccess(`Metadata updated for ${totalPosts} posts. ${engagementChanges} posts have engagement changes and are marked for re-scraping (look for 'New' badges).`)
      } else {
        setSuccess(`Metadata updated for ${totalPosts} posts. No engagement changes detected.`)
      }
      
    } catch (error) {
      console.error('Error fetching metadata:', error)
      setError('Failed to fetch metadata')
    }
  }

  async function fetchMetadataForPosts(postUrls: string[]) {
    try {
      // First, get the database IDs for the newly added posts
      const { data: posts, error: fetchError } = await supabase
        .from('posts')
        .select('id')
        .eq('user_id', user?.id)
        .in('post_url', postUrls)

      if (fetchError || !posts || posts.length === 0) {
        console.error('Failed to find newly added posts:', fetchError)
        return
      }

      const postIds = posts.map(p => p.id)

      // Start progress tracking for metadata fetching
      const initialSteps: ProgressStep[] = [
        { id: 'init', label: 'Initializing...', status: 'pending' },
        { id: 'scraping', label: 'Fetch metadata', status: 'pending' },
        { id: 'processing', label: 'Process results', status: 'pending' },
        { id: 'saving', label: 'Save to database', status: 'pending' }
      ]
      
      progressTracking.startProgress('Fetching Post Metadata', initialSteps) // Don't show misleading item count
      progressTracking.updateStep('init', { id: 'init', label: 'Starting metadata scraping...', status: 'running' })

      // Get auth token for Edge Functions
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        throw new Error('No authentication session found')
      }

      progressTracking.updateStep('init', { id: 'init', label: 'Authentication verified', status: 'completed' })
      progressTracking.updateStep('scraping', { id: 'scraping', label: 'Fetching metadata...', status: 'running' })

      // Call Edge Function directly
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/scrape-metadata`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          postIds: postIds,
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        progressTracking.updateStep('scraping', {
          id: 'scraping',
          label: 'Failed to fetch metadata',
          status: 'error',
          errorMessage: errorText
        })
        progressTracking.completeProgress()
        throw new Error(errorText || 'Failed to fetch metadata')
      }

      const result = await response.json()
      
      progressTracking.updateStep('scraping', { 
        id: 'scraping', 
        label: `Metadata completed (${result.processedPosts || 0} posts processed)`, 
        status: 'completed' 
      })
      progressTracking.updateStep('processing', { id: 'processing', label: 'Completed', status: 'completed' })
      progressTracking.updateStep('saving', { id: 'saving', label: 'Updating UI...', status: 'running' })
      
      // Wait a moment for database changes to propagate
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      // Force reload posts to show updated metadata (clear any caching)
      await loadPosts()
      
      // Force a second reload to ensure we get the latest data
      setTimeout(async () => {
        await loadPosts()
      }, 500)
      
      // Also force a third reload after a longer delay to ensure metadata updates are visible
      setTimeout(async () => {
        await loadPosts()
      }, 2000)
      
      progressTracking.updateStep('saving', { id: 'saving', label: 'Completed', status: 'completed' })
      progressTracking.updateProgress(100)
      progressTracking.completeProgress()
      
      // Update success message to show completion
      const validCount = postUrls.length
      let completionMessage = `Successfully added ${validCount} post${validCount !== 1 ? 's' : ''}`
      if (result.processedPosts) {
        completionMessage += ` and fetched metadata for ${result.processedPosts} post${result.processedPosts !== 1 ? 's' : ''}`
      }
      setSuccess(completionMessage)
      
    } catch (error) {
      console.error('Error fetching metadata for new posts:', error)
      // Update success message to show partial completion
      const validCount = postUrls.length
      setSuccess(`Successfully added ${validCount} post${validCount !== 1 ? 's' : ''}, but failed to fetch metadata`)
      setError('Failed to fetch metadata for newly added posts')
    }
  }

  async function scrapeReactions() {
    setIsSaving(true)
    setError(null)
    
    try {
      const postIds = Array.from(selectedPosts)
      
      // Start progress tracking for reactions
      const initialSteps: ProgressStep[] = [
        { id: 'init', label: 'Initializing...', status: 'pending' },
        { id: 'scraping', label: 'Scrape reactions', status: 'pending' },
        { id: 'processing', label: 'Process results', status: 'pending' },
        { id: 'saving', label: 'Save to database', status: 'pending' },
        { id: 'enrichment', label: 'Enrich profiles', status: 'pending' }
      ]
      
      // FIXED: Don't pass totalItems to avoid misleading "0 of X items processed"
      progressTracking.startProgress('Scraping Reactions', initialSteps)
      progressTracking.updateStep('init', { id: 'init', label: 'Starting reactions scraping...', status: 'running' })

      // Get auth token for Edge Functions
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        throw new Error('No authentication session found')
      }

      progressTracking.updateStep('init', { id: 'init', label: 'Authentication verified', status: 'completed' })
      progressTracking.updateStep('scraping', { id: 'scraping', label: 'Scraping reactions...', status: 'running' })

      // Call Edge Function directly
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/scrape-reactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ postIds }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        progressTracking.updateStep('scraping', {
          id: 'scraping',
          label: 'Failed to scrape reactions',
          status: 'error',
          errorMessage: errorText
        })
        progressTracking.completeProgress()
        throw new Error(errorText || 'Failed to scrape reactions')
      }

      const result = await response.json()
      
      // ENHANCED: Show detailed stats with new reactions info
      const statsMessage = `Found ${result.totalReactions || 0} reactions for ${result.processedPosts || postIds.length} posts`
      
      progressTracking.updateStep('scraping', { 
        id: 'scraping', 
        label: `Reactions completed • ${statsMessage}`, 
        status: 'completed' 
      })
      progressTracking.updateStep('processing', { id: 'processing', label: 'Completed', status: 'completed' })
      progressTracking.updateStep('saving', { id: 'saving', label: 'Completed', status: 'completed' })

      // 🆕 ENHANCED: Auto-enrich profiles (new + existing missing public_identifier)
      const enrichmentMessage = await performEnhancedEnrichment(
        postIds,
        result.profiles?.profileIds || [],
        session,
        progressTracking
      )

      progressTracking.updateProgress(100)
      progressTracking.completeProgress()
      
      // Show success message with stats
      setSuccess(`Reactions scraping completed! ${statsMessage}${enrichmentMessage}`)
      
      // Reload posts to show updated data
      await loadPosts()
      
      // Clear selection after successful completion
      setSelectedPosts(new Set())
      setLastSelectedIndex(null)
      
    } catch (error) {
      console.error('Error scraping reactions:', error)
      setError('Failed to scrape reactions')
    } finally {
      setIsSaving(false)
    }
  }

  function validateUrls(urls: string) {
    const results = validateLinkedInPosts(urls)
    setValidationResults(results)
    return results
  }

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsSaving(true)
    setError(null)
    setSuccess(null)

    try {
      if (!user) {
        setError('Not authenticated')
        return
      }

      const validationResults = validateUrls(values.postUrls)
      const validPosts = validationResults.filter(result => result.isValid)
      const invalidPosts = validationResults.filter(result => !result.isValid)

      if (validPosts.length === 0) {
        setError('No valid LinkedIn post URLs found')
        return
      }

      // Prepare posts for insertion
      const postsToInsert = validPosts.map(post => ({
        user_id: user.id,
        post_url: post.postUrl,
        post_id: post.postId,
      }))

      // Insert posts using upsert to handle duplicates
      const { error: insertError } = await supabase
        .from('posts')
        .upsert(postsToInsert, {
          onConflict: 'user_id,post_id',
          ignoreDuplicates: false
        })

      if (insertError) {
        setError(insertError.message)
      } else {
        const validCount = validPosts.length
        const duplicateCount = invalidPosts.length
        let successMessage = `Successfully added ${validCount} post${validCount !== 1 ? 's' : ''}`
        
        if (duplicateCount > 0) {
          successMessage += `. ${duplicateCount} URL${duplicateCount !== 1 ? 's were' : ' was'} invalid and skipped.`
        }
        
        successMessage += `. Fetching metadata...`
        setSuccess(successMessage)
        form.reset()
        setValidationResults([])
        setShowAddDialog(false) // Close the dialog
        await loadPosts() // Reload the posts list to get the newly added posts
        
        // Automatically fetch metadata for the newly added posts
        await fetchMetadataForPosts(validPosts.map(p => p.postUrl))
      }
    } catch {
      setError('Failed to add posts')
    } finally {
      setIsSaving(false)
    }
  }

  async function onProfileSubmit(values: z.infer<typeof profileFormSchema>) {
    setIsScrapingProfile(true)
    setError(null)
    setSuccess(null)

    try {
      if (!user) {
        setError('Not authenticated')
        return
      }

      // Collect profiles to scrape: selected monitored profiles + custom profile URL
      const profilesToScrape: string[] = []
      
      // Add selected monitored profiles
      profilesToScrape.push(...Array.from(selectedMonitoredProfiles))
      
      // Add custom profile URL if provided and not already in monitored profiles
      if (values.profileUrl && values.profileUrl.trim()) {
        const customUrl = values.profileUrl.trim()
        if (!profilesToScrape.includes(customUrl)) {
          profilesToScrape.push(customUrl)
        }
      }

      if (profilesToScrape.length === 0) {
        setError('Please select at least one monitored profile or enter an additional profile URL')
        return
      }

      const requestBody: Record<string, unknown> = {
        profileUrls: profilesToScrape  // Changed from single profileUrl to multiple profileUrls
      }

      // Add optional parameters if provided
      if (values.scrapeUntilDate) {
        requestBody.scrapeUntilDate = values.scrapeUntilDate
      }

      if (values.maxPosts && values.maxPosts.trim()) {
        const maxPostsNumber = parseInt(values.maxPosts.trim())
        if (!isNaN(maxPostsNumber) && maxPostsNumber > 0) {
          requestBody.maxPosts = maxPostsNumber
        }
      }

      // Start progress tracking
      const initialSteps: ProgressStep[] = [
        { id: 'init', label: 'Initializing...', status: 'pending' },
        { id: 'scraping', label: 'Scrape data', status: 'pending' },
        { id: 'processing', label: 'Process results', status: 'pending' },
        { id: 'saving', label: 'Save to database', status: 'pending' }
      ]
      
      const profileText = profilesToScrape.length === 1 ? 'Profile' : `${profilesToScrape.length} Profiles`
      progressTracking.startProgress(`Scraping Posts from LinkedIn ${profileText}`, initialSteps)

      // Mark initialization as completed
      progressTracking.updateStep('init', {
        id: 'init',
        label: 'Initializing...',
        status: 'completed'
      })

      // Process profiles sequentially
      let successfulProfiles = 0
      let totalNewPosts = 0
      let totalUpdatedPosts = 0
      let totalPostsWithEngagementUpdates = 0
      const profileResults: string[] = []
      
      for (let i = 0; i < profilesToScrape.length; i++) {
        const profileUrl = profilesToScrape[i]
        const profileName = profileUrl.split('/in/')[1]?.split('/')[0] || `Profile ${i + 1}`
        
        // Update current step to show which profile is being processed
        progressTracking.updateStep('scraping', {
          id: 'scraping',
          label: `Scraping ${profileName} (${i + 1}/${profilesToScrape.length})`,
          status: 'running'
        })
        
        try {
          const individualRequestBody: Record<string, unknown> = {
            profileUrl,
            ...(requestBody.scrapeUntilDate ? { scrapeUntilDate: requestBody.scrapeUntilDate } : {}),
            ...(requestBody.maxPosts ? { maxPosts: requestBody.maxPosts } : {})
          }

          // Get auth token for Edge Functions
          const { data: { session } } = await supabase.auth.getSession()
          if (!session) {
            throw new Error('No authentication session found')
          }

          const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/scrape-profile-posts`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.access_token}`,
            },
            body: JSON.stringify(individualRequestBody),
          })

          if (response.ok) {
            const result = await response.json()
            if (result.success) {
              successfulProfiles++
              totalNewPosts += result.newPosts || 0
              totalUpdatedPosts += result.updatedPosts || 0
              totalPostsWithEngagementUpdates += result.postsWithEngagementUpdates || 0
              
              profileResults.push(`${profileName}: ${result.newPosts || 0} new, ${result.updatedPosts || 0} updated`)
              console.log(`✅ Successfully scraped profile ${profileUrl}:`, result)
            } else {
              console.error(`Failed to scrape profile ${profileUrl}:`, result.error || 'Unknown error')
              profileResults.push(`${profileName}: Failed - ${result.error || 'Unknown error'}`)
            }
          } else {
            const errorText = await response.text()
            console.error(`Failed to scrape profile ${profileUrl}:`, errorText)
            profileResults.push(`${profileName}: Failed - ${errorText}`)
          }
        } catch (profileError) {
          console.error(`Error scraping profile ${profileUrl}:`, profileError)
          profileResults.push(`${profileName}: Error - ${profileError instanceof Error ? profileError.message : 'Unknown error'}`)
        }
      }

      // Mark scraping as completed
      progressTracking.updateStep('scraping', {
        id: 'scraping',
        label: `Scraping completed (${successfulProfiles}/${profilesToScrape.length} profiles)`,
        status: successfulProfiles > 0 ? 'completed' : 'error'
      })

      // Mark processing as completed
      progressTracking.updateStep('processing', {
        id: 'processing',
        label: 'Process results',
        status: 'completed'
      })

      // Update final progress with detailed stats
      if (successfulProfiles > 0) {
        progressTracking.updateStep('saving', {
          id: 'saving',
          label: `Successfully processed ${successfulProfiles} profile${successfulProfiles === 1 ? '' : 's'}`,
          status: 'completed'
        })

        // Show detailed success message
        const statsMessage = [
          `Successfully scraped ${successfulProfiles} profile${successfulProfiles === 1 ? '' : 's'}`,
          `${totalNewPosts} new posts found`,
          `${totalUpdatedPosts} posts updated`,
          totalPostsWithEngagementUpdates > 0 ? `${totalPostsWithEngagementUpdates} posts need engagement re-scraping` : null
        ].filter(Boolean).join(', ')

        setSuccess(statsMessage)
        
        // Reload posts to show new data
        await loadPosts()
      } else {
        progressTracking.updateStep('saving', {
          id: 'saving',
          label: `Failed to scrape any profiles`,
          status: 'error',
          errorMessage: 'No profiles could be scraped successfully'
        })
        setError('Failed to scrape any profiles')
      }
      
      progressTracking.completeProgress()
      
      profileForm.reset()
      setShowProfileDialog(false)
    } catch (error) {
      console.error('Profile scraping error:', error)
      progressTracking.updateStep('init', {
        id: 'init',
        label: 'Error occurred',
        status: 'error',
        errorMessage: error instanceof Error ? error.message : 'Unknown error'
      })
      progressTracking.completeProgress()
      setError('Failed to scrape profile posts')
    } finally {
      setIsScrapingProfile(false)
    }
  }

  // Sorting function
  const handleSort = (column: 'posted_at' | 'author_name' | 'scraped_at' | 'created_at' | 'metadata_last_updated_at') => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(column)
      setSortOrder('desc') // Default to desc for new columns
    }
  }

  // Sort posts based on current sort settings
  const filteredAndSortedPosts = React.useMemo(() => {
    // First apply filters
    let filtered = posts
    
    // Apply starred filter - show only starred posts
    if (showStarredOnly) {
      filtered = filtered.filter(post => post.starred === true)
    }
    
    // Apply scraping filter - show posts that need scraping (either never scraped or need re-scraping)
    if (showNeedingScrapingOnly) {
      filtered = filtered.filter(post => 
        // Never scraped (missing reactions or comments)
        (!post.last_reactions_scrape || !post.last_comments_scrape) ||
        // Needs re-scraping (engagement increased)
        (post.engagement_needs_scraping === true && 
         (post.last_reactions_scrape || post.last_comments_scrape))
      )
    }
    
    // Apply author/post ID filter
    if (authorFilter.trim()) {
      const searchTerm = authorFilter.toLowerCase()
      filtered = filtered.filter(post => 
        post.author_name?.toLowerCase().includes(searchTerm) ||
        post.post_id?.toLowerCase().includes(searchTerm)
      )
    }

    // Then apply sorting
    if (!sortBy) return filtered

    const sorted = [...filtered].sort((a, b) => {
      let valueA: unknown, valueB: unknown

      switch (sortBy) {
        case 'posted_at':
          valueA = a.posted_at_iso ? new Date(a.posted_at_iso).getTime() : 0
          valueB = b.posted_at_iso ? new Date(b.posted_at_iso).getTime() : 0
          break
        case 'author_name':
          valueA = a.author_name || ''
          valueB = b.author_name || ''
          break
        case 'scraped_at':
          valueA = a.scraped_at ? new Date(a.scraped_at).getTime() : 0
          valueB = b.scraped_at ? new Date(b.scraped_at).getTime() : 0
          break
        case 'created_at':
          valueA = a.created_at ? new Date(a.created_at).getTime() : 0
          valueB = b.created_at ? new Date(b.created_at).getTime() : 0
          break
        case 'metadata_last_updated_at':
          valueA = a.metadata_last_updated_at ? new Date(a.metadata_last_updated_at).getTime() : 0
          valueB = b.metadata_last_updated_at ? new Date(b.metadata_last_updated_at).getTime() : 0
          break
        default:
          return 0
      }

      const numA = Number(valueA)
      const numB = Number(valueB)
      if (numA < numB) return sortOrder === 'asc' ? -1 : 1
      if (numA > numB) return sortOrder === 'asc' ? 1 : -1
      return 0
    })

    return sorted
  }, [posts, sortBy, sortOrder, showNeedingScrapingOnly, showStarredOnly, authorFilter])

  // Pagination logic
  const totalPages = Math.ceil(filteredAndSortedPosts.length / itemsPerPage)
  const paginatedPosts = React.useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage
    const endIndex = startIndex + itemsPerPage
    return filteredAndSortedPosts.slice(startIndex, endIndex)
  }, [filteredAndSortedPosts, currentPage, itemsPerPage])

  // Reset to first page when filters change
  React.useEffect(() => {
    setCurrentPage(1)
  }, [showNeedingScrapingOnly, showStarredOnly, authorFilter, sortBy, sortOrder])

  // Count posts needing scraping
  const postsNeedingScraping = React.useMemo(() => {
    return posts.filter(post => 
      // Never scraped (missing reactions or comments)
      (!post.last_reactions_scrape || !post.last_comments_scrape) ||
      // Needs re-scraping (engagement increased)
      (post.engagement_needs_scraping === true && 
       (post.last_reactions_scrape || post.last_comments_scrape))
    ).length
  }, [posts])

  // Count starred posts
  const starredPostsCount = React.useMemo(() => {
    return posts.filter(post => post.starred === true).length
  }, [posts])

  // Watch for changes in the textarea to validate in real-time
  const watchedUrls = form.watch('postUrls')
  useEffect(() => {
    if (watchedUrls.trim()) {
      validateUrls(watchedUrls)
    } else {
      setValidationResults([])
    }
  }, [watchedUrls])

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
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Posts</h1>
          <div className="flex gap-2">
            <Dialog open={showProfileDialog} onOpenChange={setShowProfileDialog}>
              <DialogTrigger asChild>
                <Button variant="outline">Scrape from Profile</Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Scrape Posts from LinkedIn Profile</DialogTitle>
                  <DialogDescription>
                    Select monitored profiles or enter a custom LinkedIn profile URL to automatically scrape and add all posts from that profile.
                  </DialogDescription>
                </DialogHeader>

                {/* Monitored Profiles Section */}
                {monitoredProfiles.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-medium text-gray-900">Monitored Profiles</h3>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedMonitoredProfiles(new Set(monitoredProfiles))}
                        >
                          Select All
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedMonitoredProfiles(new Set())}
                        >
                          Clear All
                        </Button>
                      </div>
                    </div>
                    <div className="grid gap-2 max-h-32 overflow-y-auto border rounded-md p-3">
                      {monitoredProfiles.map((profile, index) => (
                        <label key={index} className="flex items-center space-x-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedMonitoredProfiles.has(profile)}
                            onChange={(e) => {
                              const newSelected = new Set(selectedMonitoredProfiles)
                              if (e.target.checked) {
                                newSelected.add(profile)
                              } else {
                                newSelected.delete(profile)
                              }
                              setSelectedMonitoredProfiles(newSelected)
                            }}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="text-sm text-gray-700 truncate flex-1">
                            {profile}
                          </span>
                        </label>
                      ))}
                    </div>
                    <div className="text-xs text-gray-500">
                      {selectedMonitoredProfiles.size} of {monitoredProfiles.length} monitored profiles selected
                    </div>
                    <div className="border-b"></div>
                  </div>
                )}
                
                <Form {...profileForm}>
                  <form onSubmit={profileForm.handleSubmit(onProfileSubmit)} className="space-y-4">
                    <FormField
                      control={profileForm.control}
                      name="profileUrl"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Additional LinkedIn Profile URL (Optional)</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="https://www.linkedin.com/in/username/"
                              {...field}
                            />
                          </FormControl>
                          <FormDescription>
                            Enter an additional LinkedIn profile URL to scrape along with selected monitored profiles
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={profileForm.control}
                        name="scrapeUntilDate"
                        render={({ field }) => (
                          <FormItem className="flex flex-col">
                            <FormLabel>Scrape Until Date (Optional)</FormLabel>
                            <Popover>
                              <PopoverTrigger asChild>
                                <FormControl>
                                  <Button
                                    variant="outline"
                                    className={`w-full pl-3 text-left font-normal ${!field.value && "text-muted-foreground"}`}
                                  >
                                    {field.value ? (
                                      format(new Date(field.value), "PPP")
                                    ) : (
                                      <span>Pick a date</span>
                                    )}
                                    <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                  </Button>
                                </FormControl>
                              </PopoverTrigger>
                              <PopoverContent className="w-auto p-0" align="start" side="bottom" sideOffset={4}>
                                <Calendar
                                  mode="single"
                                  selected={field.value ? new Date(field.value) : undefined}
                                  onSelect={(date) => {
                                    if (date) {
                                      field.onChange(format(date, "yyyy-MM-dd"))
                                    } else {
                                      field.onChange("")
                                    }
                                  }}
                                  disabled={(date) =>
                                    date > new Date() || date < new Date("1900-01-01")
                                  }
                                  toDate={new Date()} // Don't show dates beyond today
                                  fromDate={new Date("1900-01-01")} // Don't show dates before 1900
                                  showOutsideDays={false} // Hide days from other months
                                  captionLayout="dropdown" // Compact month/year selection
                                  className="p-2"
                                  initialFocus
                                />
                                {field.value && (
                                  <div className="p-2 border-t">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => field.onChange("")}
                                      className="w-full h-8 text-xs"
                                    >
                                      Clear date
                                    </Button>
                                  </div>
                                )}
                              </PopoverContent>
                            </Popover>
                            <FormDescription>
                              Stop scraping posts older than this date
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={profileForm.control}
                        name="maxPosts"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Max Posts (Optional)</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                placeholder="e.g., 50"
                                min="1"
                                {...field}
                              />
                            </FormControl>
                            <FormDescription>
                              Maximum number of posts to scrape
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="flex justify-end gap-2 pt-4">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setShowProfileDialog(false)
                          profileForm.reset()
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        disabled={isScrapingProfile}
                      >
                        {isScrapingProfile ? 'Scraping Profile...' : 'Scrape Posts'}
                      </Button>
                    </div>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
            <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
              <DialogTrigger asChild>
                <Button>Add Manually</Button>
              </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Add LinkedIn Posts</DialogTitle>
                <DialogDescription>
                  Enter LinkedIn post URLs or post IDs (one per line). Supported formats:
                  <br />
                  • Full URL: https://www.linkedin.com/posts/username_activity-7302346926123798528
                  • URL with title: https://www.linkedin.com/posts/username_title-activity-7302346926123798528-suffix
                  • Post ID: 7302346926123798528
                </DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="postUrls"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>LinkedIn Post URLs or IDs</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="https://www.linkedin.com/posts/username_activity-7302346926123798528&#10;7302346926123798529&#10;..."
                            className="min-h-32"
                            disabled={isSaving}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Validation Results */}
                  {validationResults.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="text-sm font-medium">Validation Results:</h3>
                      <div className="max-h-32 overflow-y-auto space-y-1">
                        {validationResults.map((result, index) => (
                          <Alert
                            key={index}
                            variant={result.isValid ? "default" : "destructive"}
                            className="py-2"
                          >
                            <AlertDescription className="text-sm">
                              {result.isValid ? (
                                <span className="text-green-600">
                                  ✅ Valid: {result.postId}
                                </span>
                              ) : (
                                <span className="text-red-600">
                                  ❌ Invalid: {result.error}
                                </span>
                              )}
                            </AlertDescription>
                          </Alert>
                        ))}
                      </div>
                    </div>
                  )}

                  {error && (
                    <Alert variant="destructive">
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}

                  {success && (
                    <Alert>
                      <AlertDescription className="text-green-600">
                        {success}
                      </AlertDescription>
                    </Alert>
                  )}

                  <div className="flex gap-2 justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setShowAddDialog(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={isSaving || validationResults.some(r => !r.isValid)}
                    >
                      {isSaving ? 'Adding Posts...' : 'Add Posts'}
                    </Button>
                  </div>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
          </div>
        </div>

        {/* Success/Error Messages */}
        {(error || success) && (
          <div className="mb-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {success && (
              <Alert>
                <AlertDescription className="text-green-600">
                  {success}
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {/* Action Buttons */}
        {posts.length > 0 && (
          <div className="flex items-center gap-2 mb-4">
            {/* Split Button for Scraping Engagements - First */}
            <div className="flex">
              <Button
                onClick={scrapeBothEngagements}
                disabled={selectedPosts.size === 0 || isSaving}
                size="sm"
                className="bg-black hover:bg-gray-800 text-white rounded-r-none border-r border-gray-600"
              >
                Scrape Engagements ({selectedPosts.size})
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    disabled={selectedPosts.size === 0 || isSaving}
                    size="sm"
                    className="bg-black hover:bg-gray-800 text-white rounded-l-none px-2 border-l-0"
                  >
                    <ChevronDownIcon className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => handleAction('reactions')}>
                    Scrape Reactions Only
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleAction('comments')}>
                    Scrape Comments Only
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            
            {/* Show these buttons only when posts are selected */}
            {selectedPosts.size > 0 && (
              <>
                <Button
                  variant="outline"
                  onClick={() => handleAction('metadata')}
                  disabled={selectedPosts.size === 0}
                  size="sm"
                >
                  Fetch Post Metadata ({selectedPosts.size})
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => handleAction('delete')}
                  disabled={selectedPosts.size === 0}
                  size="sm"
                >
                  Delete Posts ({selectedPosts.size})
                </Button>
              </>
            )}

            
            <div className="ml-auto flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Search by author or post ID..."
                  value={authorFilter}
                  onChange={(e) => setAuthorFilter(e.target.value)}
                  className="w-48 h-8 text-sm"
                />
                {authorFilter && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setAuthorFilter('')}
                    className="h-8 px-2 text-xs text-gray-500 hover:text-gray-700"
                  >
                    Clear
                  </Button>
                )}
              </div>
              
              {postsNeedingScraping > 0 && (
                <button
                  onClick={() => {
                    setShowNeedingScrapingOnly(!showNeedingScrapingOnly)
                    if (!showNeedingScrapingOnly) {
                      setAuthorFilter('') // Clear author filter
                    }
                  }}
                  className={`text-sm cursor-pointer transition-colors border-b border-dotted whitespace-nowrap ${
                    showNeedingScrapingOnly 
                      ? "text-blue-600 border-blue-600" 
                      : "text-gray-600 hover:text-blue-600 border-gray-400 hover:border-blue-600"
                  }`}
                  title={showNeedingScrapingOnly ? "Show all posts" : "Show only posts that need scraping (unscraped or needing re-scraping due to increased engagement)"}
                >
                  {showNeedingScrapingOnly ? "Show all posts" : `Show posts needing scraping (${postsNeedingScraping})`}
                </button>
              )}
              
              {starredPostsCount > 0 && (
                <button
                  onClick={() => {
                    setShowStarredOnly(!showStarredOnly)
                    if (!showStarredOnly) {
                      setAuthorFilter('') // Clear author filter
                      setShowNeedingScrapingOnly(false) // Clear scraping filter
                    }
                  }}
                  className={`text-sm cursor-pointer transition-colors border-b border-dotted whitespace-nowrap ${
                    showStarredOnly 
                      ? "text-yellow-600 border-yellow-600" 
                      : "text-gray-600 hover:text-yellow-600 border-gray-400 hover:border-yellow-600"
                  }`}
                  title={showStarredOnly ? "Show all posts" : "Show only starred posts that need rescraping"}
                >
                  {showStarredOnly ? "Show all posts" : `Show starred posts (${starredPostsCount})`}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Posts Table */}
        <Card>
          <CardContent className="px-3 py-0">
            {isLoading ? (
              <div className="p-6">
                <div className="space-y-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-12 bg-gray-200 rounded animate-pulse"></div>
                  ))}
                </div>
              </div>
            ) : posts.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <p className="text-lg mb-2">No posts added yet</p>
                <p className="text-sm">Click &quot;Add Manually&quot; to get started with LinkedIn engagement analysis</p>
              </div>
            ) : (
              <>
              {/* Top Pagination Controls */}
              {!isLoading && filteredAndSortedPosts.length > 0 && totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-b">
                  <div className="text-sm text-gray-600">
                    {selectedPosts.size > 0 ? (
                      `${selectedPosts.size} post${selectedPosts.size === 1 ? '' : 's'} selected`
                    ) : (
                      `Showing ${(currentPage - 1) * itemsPerPage + 1} to ${Math.min(currentPage * itemsPerPage, filteredAndSortedPosts.length)} of ${filteredAndSortedPosts.length} posts`
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
              
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12 text-center">#</TableHead>
                    <TableHead className="w-12">
                      <Checkbox
                        checked={
                          filteredAndSortedPosts.length > 0 && 
                          filteredAndSortedPosts.every(post => selectedPosts.has(post.id))
                        }
                        onCheckedChange={toggleSelectAll}
                        aria-label="Select all visible posts"
                      />
                    </TableHead>
                    <TableHead className="w-12 text-center" title="Star posts that need rescraping">
                      <Star className="h-4 w-4 mx-auto text-gray-400" />
                    </TableHead>
                    <TableHead>Content</TableHead>
                    <TableHead 
                      className="cursor-pointer hover:bg-gray-50 select-none"
                      onClick={() => handleSort('posted_at')}
                    >
                      <div className="flex items-center gap-1">
                        Published
                        {sortBy === 'posted_at' && (
                          <span className="text-xs">
                            {sortOrder === 'asc' ? '↑' : '↓'}
                          </span>
                        )}
                      </div>
                    </TableHead>
                    <TableHead 
                      className="cursor-pointer hover:bg-gray-50 select-none"
                      onClick={() => handleSort('author_name')}
                    >
                      <div className="flex items-center gap-1">
                        Author
                        {sortBy === 'author_name' && (
                          <span className="text-xs">
                            {sortOrder === 'asc' ? '↑' : '↓'}
                          </span>
                        )}
                      </div>
                    </TableHead>
                    <TableHead>Engagement</TableHead>
                    <TableHead 
                      className="cursor-pointer hover:bg-gray-50 select-none"
                      onClick={() => handleSort('scraped_at')}
                    >
                      <div className="flex items-center gap-1">
                        Scraped
                        {sortBy === 'scraped_at' && (
                          <span className="text-xs">
                            {sortOrder === 'asc' ? '↑' : '↓'}
                          </span>
                        )}
                      </div>
                    </TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead 
                      className="cursor-pointer hover:bg-gray-50 select-none"
                      onClick={() => handleSort('created_at')}
                    >
                      <div className="flex items-center gap-1">
                        Date Added
                        {sortBy === 'created_at' && (
                          <span className="text-xs">
                            {sortOrder === 'asc' ? '↑' : '↓'}
                          </span>
                        )}
                      </div>
                    </TableHead>
                    <TableHead>Last Scraped</TableHead>
                    <TableHead 
                      className="cursor-pointer hover:bg-gray-50 select-none"
                      onClick={() => handleSort('metadata_last_updated_at')}
                    >
                      <div className="flex items-center gap-1">
                        Metadata Updated
                        {sortBy === 'metadata_last_updated_at' && (
                          <span className="text-xs">
                            {sortOrder === 'asc' ? '↑' : '↓'}
                          </span>
                        )}
                      </div>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedPosts.map((post, index) => (
                    <TableRow 
                      key={post.id}
                      className={recentlyAddedPosts.has(post.id) ? "bg-green-50 border-l-4 border-l-green-500" : ""}
                    >
                      <TableCell className="text-center text-sm text-gray-500 font-mono">
                        {(currentPage - 1) * itemsPerPage + index + 1}
                      </TableCell>
                      <TableCell>
                        <Checkbox
                          checked={selectedPosts.has(post.id)}
                          onCheckedChange={() => {
                            // This will be handled by the onClick event below
                          }}
                          onClick={(event: React.MouseEvent) => {
                            event.preventDefault() // Prevent default to handle manually
                            togglePostSelection(post.id, index, event.shiftKey)
                          }}
                          aria-label={`Select post ${post.post_id}`}
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <button
                          onClick={() => togglePostStar(post.id)}
                          className="p-1 hover:bg-gray-100 rounded transition-colors"
                          title={post.starred ? "Remove from starred posts" : "Star this post for rescraping"}
                        >
                          <Star 
                            className={`h-4 w-4 ${
                              post.starred 
                                ? "text-yellow-500 fill-yellow-500" 
                                : "text-gray-300 hover:text-yellow-400"
                            }`} 
                          />
                        </button>
                      </TableCell>
                      <TableCell className="max-w-xs">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              setPreviewPost(post)
                              setShowPreviewDialog(true)
                            }}
                            className="text-blue-600 hover:text-blue-800 font-medium text-sm flex-shrink-0 border-b border-dotted border-blue-600 hover:border-blue-800 cursor-pointer"
                          >
                            Post {post.post_id}
                          </button>
                          {recentlyAddedPosts.has(post.id) && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 border border-green-200">
                              NEW
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm text-gray-600">
                          {post.posted_at_iso 
                            ? new Date(post.posted_at_iso).toLocaleDateString()
                            : 'Unknown'
                          }
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-gray-600">
                          {post.author_name || 'Unknown'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="flex gap-3 text-sm">
                            <span className="flex items-center gap-1">
                              👍 <span className="font-medium">{post.num_likes || 0}</span>
                            </span>
                            <span className="flex items-center gap-1">
                              💬 <span className="font-medium">{post.num_comments || 0}</span>
                            </span>
                            <span className="flex items-center gap-1">
                              🔄 <span className="font-medium">{post.num_shares || 0}</span>
                            </span>
                          </div>
                          {post.engagement_needs_scraping && (post.last_reactions_scrape || post.last_comments_scrape) && (
                            <Badge variant="secondary" className="text-xs bg-orange-100 text-orange-800 border-orange-200">
                              New
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {(post.reactions_count || post.comments_count) ? (
                          <div className="flex gap-3 text-sm">
                            <span className="flex items-center gap-1">
                              👍 
                              {post.reactions_count ? (
                                <button
                                  onClick={() => loadEngagementData(post, 'reactions')}
                                  className="font-medium text-green-600 hover:text-green-800 hover:underline cursor-pointer"
                                  disabled={loadingEngagement}
                                >
                                  {post.reactions_count}
                                </button>
                              ) : (
                                <span className="font-medium text-green-600">0</span>
                              )}
                            </span>
                            <span className="flex items-center gap-1">
                              💬 
                              {post.comments_count ? (
                                <button
                                  onClick={() => loadEngagementData(post, 'comments')}
                                  className="font-medium text-green-600 hover:text-green-800 hover:underline cursor-pointer"
                                  disabled={loadingEngagement}
                                >
                                  {post.comments_count}
                                </button>
                              ) : (
                                <span className="font-medium text-green-600">0</span>
                              )}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400">None</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Badge 
                            variant={post.posted_at_iso ? "default" : "secondary"} 
                            className="text-xs px-2 py-0"
                            title={post.posted_at_iso ? "Metadata fetched" : "Metadata not fetched"}
                          >
                            {post.posted_at_iso ? '✓' : '○'} M
                          </Badge>
                          <Badge 
                            variant={post.last_reactions_scrape ? "default" : "secondary"} 
                            className="text-xs px-2 py-0"
                            title={post.last_reactions_scrape ? "Reactions scraped" : "Reactions not scraped"}
                          >
                            {post.last_reactions_scrape ? '✓' : '○'} R
                          </Badge>
                          <Badge 
                            variant={post.last_comments_scrape ? "default" : "secondary"} 
                            className="text-xs px-2 py-0"
                            title={post.last_comments_scrape ? "Comments scraped" : "Comments not scraped"}
                          >
                            {post.last_comments_scrape ? '✓' : '○'} C
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-gray-600">
                        {post.created_at 
                          ? new Date(post.created_at).toLocaleDateString() 
                          : 'Unknown'
                        }
                      </TableCell>
                      <TableCell className="text-sm text-gray-600">
                        {(() => {
                          const lastReactionScrape = post.last_reactions_scrape ? new Date(post.last_reactions_scrape) : null
                          const lastCommentScrape = post.last_comments_scrape ? new Date(post.last_comments_scrape) : null
                          
                          // Find the most recent scrape date
                          const dates = [lastReactionScrape, lastCommentScrape].filter((d): d is Date => d !== null)
                          if (dates.length === 0) return 'Never'
                          
                          const mostRecent = new Date(Math.max(...dates.map(d => d.getTime())))
                          return mostRecent.toLocaleDateString()
                        })()}
                      </TableCell>
                      <TableCell className="text-sm text-gray-600">
                        {post.metadata_last_updated_at 
                          ? new Date(post.metadata_last_updated_at).toLocaleDateString()
                          : 'Never'
                        }
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              
              {!isLoading && filteredAndSortedPosts.length > 0 && totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t">
                  <div className="text-sm text-gray-600">
                    {selectedPosts.size > 0 ? (
                      `${selectedPosts.size} post${selectedPosts.size === 1 ? '' : 's'} selected`
                    ) : (
                      `Showing ${(currentPage - 1) * itemsPerPage + 1} to ${Math.min(currentPage * itemsPerPage, filteredAndSortedPosts.length)} of ${filteredAndSortedPosts.length} posts`
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
              </>
            )}
          </CardContent>
        </Card>

        {/* Confirmation Dialog */}
        <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Confirm Action</DialogTitle>
              <DialogDescription>
                {confirmAction === 'delete' && 
                  `Are you sure you want to delete ${selectedPosts.size} post${selectedPosts.size !== 1 ? 's' : ''}?`
                }
                {confirmAction === 'metadata' && 
                  `Do you want to fetch metadata for ${selectedPosts.size === posts.length ? 'all posts' : `${selectedPosts.size} selected post${selectedPosts.size !== 1 ? 's' : ''}`}? This will get post content, author info, and publication date.`
                }
                {confirmAction === 'reactions' && 
                  `Do you want to scrape reactions for ${selectedPosts.size === posts.length ? 'all posts' : `${selectedPosts.size} selected post${selectedPosts.size !== 1 ? 's' : ''}`}?`
                }
                {confirmAction === 'comments' && 
                  `Do you want to scrape comments for ${selectedPosts.size === posts.length ? 'all posts' : `${selectedPosts.size} selected post${selectedPosts.size !== 1 ? 's' : ''}`}?`
                }
              </DialogDescription>
            </DialogHeader>
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => setShowConfirmDialog(false)}
                disabled={isSaving}
              >
                Cancel
              </Button>
              <Button
                onClick={confirmActionHandler}
                variant={confirmAction === 'delete' ? 'destructive' : 'default'}
                disabled={isSaving}
              >
                {isSaving ? (
                  confirmAction === 'metadata' ? 'Fetching Metadata...' :
                  confirmAction === 'reactions' ? 'Scraping Reactions...' :
                  confirmAction === 'comments' ? 'Scraping Comments...' :
                  'Deleting...'
                ) : (
                  confirmAction === 'delete' ? 'Delete' : 'Confirm'
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Post Preview Dialog */}
        <Dialog open={showPreviewDialog} onOpenChange={setShowPreviewDialog}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Post Preview</DialogTitle>
              <DialogDescription>
                View the full content and details of this LinkedIn post.
              </DialogDescription>
            </DialogHeader>
            
            {/* Author Info */}
            {previewPost?.author_name && (
              <div className="flex items-center gap-2 pb-4 border-b">
                <span className="text-sm text-gray-600">By</span>
                {previewPost.author_profile_url ? (
                  <a
                    href={previewPost.author_profile_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-800 font-medium hover:underline"
                  >
                    {previewPost.author_name}
                  </a>
                ) : (
                  <span className="font-medium">{previewPost.author_name}</span>
                )}
                {previewPost.posted_at_iso && (
                  <span className="text-gray-500">
                    • {new Date(previewPost.posted_at_iso).toLocaleDateString()}
                  </span>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto h-6 px-2 text-xs"
                  onClick={() => window.open(previewPost.post_url, '_blank')}
                >
                  <svg className="w-3 h-3 mr-1" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                  </svg>
                  Open on LinkedIn
                </Button>
              </div>
            )}
            <div className="space-y-4">
              {previewPost?.post_text && (
                <div>
                  <h4 className="font-medium text-sm text-gray-700 mb-2">Content</h4>
                  <div className="bg-gray-50 p-3 rounded-lg">
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">
                      {previewPost.post_text}
                    </p>
                  </div>
                </div>
              )}
              
              {previewPost && (
                <div>
                  <h4 className="font-medium text-sm text-gray-700 mb-2">LinkedIn Engagement Stats</h4>
                  <div className="flex gap-4 text-sm mb-3">
                    <span className="flex items-center gap-1">
                      👍 <span className="font-medium">{previewPost.num_likes || 0}</span> reactions
                    </span>
                    <span className="flex items-center gap-1">
                      💬 <span className="font-medium">{previewPost.num_comments || 0}</span> comments
                    </span>
                    <span className="flex items-center gap-1">
                      🔄 <span className="font-medium">{previewPost.num_shares || 0}</span> shares
                    </span>
                  </div>
                  
                  {((previewPost.reactions_count && previewPost.reactions_count > 0) || (previewPost.comments_count && previewPost.comments_count > 0)) && (
                    <>
                      <h4 className="font-medium text-sm text-gray-700 mb-2">Scraped Data</h4>
                      <div className="flex gap-4 text-sm">
                        <span className="flex items-center gap-1">
                          👍 <span className="font-medium text-green-600">{previewPost.reactions_count || 0}</span> reactions scraped
                        </span>
                        <span className="flex items-center gap-1">
                          💬 <span className="font-medium text-green-600">{previewPost.comments_count || 0}</span> comments scraped
                        </span>
                      </div>
                                  </>
            )}
            
          </div>
        )}

              <div className="flex gap-2 pt-4">
                <Button asChild variant="outline">
                  <a
                    href={previewPost?.post_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View on LinkedIn
                  </a>
                </Button>
                <Button 
                  variant="outline"
                  onClick={() => setShowPreviewDialog(false)}
                >
                  Close
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Engagement Details Dialog */}
        <Dialog open={showEngagementDialog} onOpenChange={setShowEngagementDialog}>
          <DialogContent className="max-w-2xl w-full max-h-[80vh] overflow-hidden">
            <DialogHeader>
              <DialogTitle>
                {engagementData?.type === 'reactions' ? 'People Who Reacted' : 'People Who Commented'}
              </DialogTitle>
              <DialogDescription>
                {engagementData?.profiles.length || 0} unique {engagementData?.type === 'reactions' ? 'people who reacted' : 'people who commented'} on Post {engagementData?.post?.post_id}
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-3">
              {loadingEngagement ? (
                <div className="text-center py-8">
                  <div className="text-sm text-gray-500">Loading...</div>
                </div>
              ) : engagementData?.profiles.length === 0 ? (
                <div className="text-center py-8">
                  <div className="text-sm text-gray-500">No {engagementData.type} found</div>
                </div>
              ) : (
                <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
                  {engagementData?.profiles.map((profile: Record<string, unknown>, index: number) => (
                    <div key={profile.id as string || index} className="flex items-start gap-3 p-3 border rounded-lg hover:bg-gray-50">
                      <ProfileAvatar
                        name={((profile.profiles as Record<string, unknown>)?.name as string) || 'Unknown'}
                        profilePictures={(profile.profiles as Record<string, unknown>)?.profile_pictures as Record<string, string> | undefined}
                        profilePictureUrl={(profile.profiles as Record<string, unknown>)?.profile_picture_url as string}
                        size="md"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          {((profile.profiles as Record<string, unknown>)?.profile_url as string) ? (
                            <a
                              href={(profile.profiles as Record<string, unknown>)?.profile_url as string}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium text-blue-600 hover:text-blue-800 hover:underline text-sm truncate"
                            >
                              {((profile.profiles as Record<string, unknown>)?.name as string) || 'Unknown'}
                            </a>
                          ) : (
                            <span className="font-medium text-sm truncate">{((profile.profiles as Record<string, unknown>)?.name as string) || 'Unknown'}</span>
                          )}
                          {engagementData.type === 'reactions' && (profile.reaction_type as string) && (
                            <Badge variant="outline" className="text-xs flex-shrink-0">
                              {profile.reaction_type as string}
                            </Badge>
                          )}
                        </div>
                        {((profile.profiles as Record<string, unknown>)?.headline as string) && (
                          <div className="text-xs text-gray-500 line-clamp-1">
                            {(profile.profiles as Record<string, unknown>)?.headline as string}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-end pt-4 border-t">
                <Button 
                  variant="outline"
                  onClick={() => setShowEngagementDialog(false)}
                >
                  Close
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Progress Overlay */}
        <ProgressOverlay
          isOpen={progressTracking.isOpen}
          onClose={progressTracking.closeProgress}
          title={progressTracking.title}
          steps={progressTracking.steps}
          overallProgress={progressTracking.overallProgress}
          totalItems={progressTracking.totalItems}
          processedItems={progressTracking.processedItems}
          isCompleted={progressTracking.isCompleted}
          canCancel={false}
        />
      </div>
    </div>
  )
}
