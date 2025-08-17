'use client'

import React, { useState, useEffect } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import * as z from 'zod'
import { createClient } from '@/lib/supabase/client'
import { validateLinkedInPosts, type LinkedInPostData } from '@/lib/utils/linkedin'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import { ChevronDownIcon, CalendarIcon } from 'lucide-react'
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
  profileUrl: z.string().min(1, 'Please enter a LinkedIn profile URL').url('Please enter a valid URL'),
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
  const [user, setUser] = useState<any>(null)
  const [selectedPosts, setSelectedPosts] = useState<Set<string>>(new Set())
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [showProfileDialog, setShowProfileDialog] = useState(false)
  const [isScrapingProfile, setIsScrapingProfile] = useState(false)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  
  // Progress tracking
  const progressTracking = useProgressTracking()
  const [confirmAction, setConfirmAction] = useState<'metadata' | 'reactions' | 'comments' | 'delete' | null>(null)
  
  // Helper function to poll progress
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
            setSuccess(data.result?.message || 'Operation completed successfully')
            if (!skipLoadPosts) {
              loadPosts() // Reload posts
            }
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
  const [previewPost, setPreviewPost] = useState<Post | null>(null)
  const [showPreviewDialog, setShowPreviewDialog] = useState(false)
  const [showEngagementDialog, setShowEngagementDialog] = useState(false)
  const [engagementData, setEngagementData] = useState<{ post: Post; type: 'reactions' | 'comments'; profiles: any[] } | null>(null)
  const [loadingEngagement, setLoadingEngagement] = useState(false)
  const [sortBy, setSortBy] = useState<'posted_at' | 'author_name' | 'scraped_at' | 'created_at' | null>('posted_at')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [showNewEngagementOnly, setShowNewEngagementOnly] = useState(false)
  const [showUnscrapedOnly, setShowUnscrapedOnly] = useState(false)
  const [authorFilter, setAuthorFilter] = useState('')
  const supabase = createClient()

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
    loadUser()
    loadPosts()
  }, [])

  async function loadUser() {
    const { data: { user } } = await supabase.auth.getUser()
    setUser(user)
  }

  async function loadPosts() {
    setIsLoading(true)
    try {
      const { data, error } = await supabase
        .from('posts')
        .select(`
          *,
          reactions_count:reactions(count),
          comments_count:comments(count)
        `)
        .order('created_at', { ascending: false })

      if (error) {
        setError(error.message)
      } else {
        // Transform the data to include counts
        const postsWithCounts = (data || []).map(post => ({
          ...post,
          reactions_count: post.reactions_count?.[0]?.count || 0,
          comments_count: post.comments_count?.[0]?.count || 0
        }))
        setPosts(postsWithCounts)
      }
    } catch (error) {
      setError('Failed to load posts')
    } finally {
      setIsLoading(false)
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
        await loadPosts()
      }
    } catch (error) {
      setError('Failed to delete posts')
    }
  }

  function togglePostSelection(postId: string) {
    const newSelection = new Set(selectedPosts)
    if (newSelection.has(postId)) {
      newSelection.delete(postId)
    } else {
      newSelection.add(postId)
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
    } else {
      // Select all filtered posts (keeping any existing selections from other filters)
      const newSelected = new Set(selectedPosts)
      filteredIds.forEach(id => newSelected.add(id))
      setSelectedPosts(newSelected)
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
      const totalPosts = selectedPosts.size

      // Start progress tracking
      const initialSteps: ProgressStep[] = [
        { id: 'init', label: 'Initializing...', status: 'pending' },
        { id: 'reactions', label: 'Scrape reactions', status: 'pending' },
        { id: 'comments', label: 'Scrape comments', status: 'pending' },
        { id: 'saving', label: 'Finalizing results', status: 'pending' }
      ]
      
      progressTracking.startProgress('Scraping Reactions & Comments', initialSteps, totalPosts)
      progressTracking.updateStep('init', { id: 'init', label: 'Starting scrapers...', status: 'running' })

      // Start both progress-enabled scrapers in parallel
      const [reactionsResponse, commentsResponse] = await Promise.allSettled([
        fetch('/api/scrape/reactions-progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ postIds }),
        }),
        fetch('/api/scrape/comments-progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ postIds }),
        })
      ])

      progressTracking.updateStep('init', { id: 'init', label: 'Scrapers started', status: 'completed' })
      progressTracking.updateProgress(20)

      // Get progress IDs
      let reactionsProgressId = null
      let commentsProgressId = null

      if (reactionsResponse.status === 'fulfilled' && reactionsResponse.value.ok) {
        const result = await reactionsResponse.value.json()
        reactionsProgressId = result.progressId
        progressTracking.updateStep('reactions', { id: 'reactions', label: 'Scraping reactions...', status: 'running' })
      } else {
        progressTracking.updateStep('reactions', { id: 'reactions', label: 'Failed to start reactions scraper', status: 'error' })
      }

      if (commentsResponse.status === 'fulfilled' && commentsResponse.value.ok) {
        const result = await commentsResponse.value.json()
        commentsProgressId = result.progressId
        progressTracking.updateStep('comments', { id: 'comments', label: 'Scraping comments...', status: 'running' })
      } else {
        progressTracking.updateStep('comments', { id: 'comments', label: 'Failed to start comments scraper', status: 'error' })
      }

      // Poll both progress endpoints simultaneously
      const progressPromises = []
      if (reactionsProgressId) {
        progressPromises.push(
          new Promise((resolve) => {
            const pollReactions = setInterval(async () => {
              try {
                const response = await fetch(`/api/scrape/reactions-progress?progressId=${reactionsProgressId}`)
                const data = await response.json()
                
                if (data.status === 'completed') {
                  progressTracking.updateStep('reactions', { id: 'reactions', label: `Reactions completed (${data.totalReactions || 0} found)`, status: 'completed' })
                  clearInterval(pollReactions)
                  resolve(data)
                } else if (data.status === 'error') {
                  progressTracking.updateStep('reactions', { id: 'reactions', label: 'Reactions failed', status: 'error', errorMessage: data.error })
                  clearInterval(pollReactions)
                  resolve(data)
                }
              } catch (error) {
                progressTracking.updateStep('reactions', { id: 'reactions', label: 'Reactions failed', status: 'error', errorMessage: 'Connection error' })
                clearInterval(pollReactions)
                resolve({ status: 'error', error: 'Connection error' })
              }
            }, 1000)
          })
        )
      }

      if (commentsProgressId) {
        progressPromises.push(
          new Promise((resolve) => {
            const pollComments = setInterval(async () => {
              try {
                const response = await fetch(`/api/scrape/comments-progress?progressId=${commentsProgressId}`)
                const data = await response.json()
                
                if (data.status === 'completed') {
                  progressTracking.updateStep('comments', { id: 'comments', label: `Comments completed (${data.totalComments || 0} found)`, status: 'completed' })
                  clearInterval(pollComments)
                  resolve(data)
                } else if (data.status === 'error') {
                  progressTracking.updateStep('comments', { id: 'comments', label: 'Comments failed', status: 'error', errorMessage: data.error })
                  clearInterval(pollComments)
                  resolve(data)
                }
              } catch (error) {
                progressTracking.updateStep('comments', { id: 'comments', label: 'Comments failed', status: 'error', errorMessage: 'Connection error' })
                clearInterval(pollComments)
                resolve({ status: 'error', error: 'Connection error' })
              }
            }, 1000)
          })
        )
      }

      // Wait for both to complete
      const results = await Promise.all(progressPromises)
      
      progressTracking.updateStep('saving', { id: 'saving', label: 'Finalizing...', status: 'running' })
      progressTracking.updateProgress(90)

      // Clear engagement flags for successfully scraped posts
      await clearEngagementFlagsForPosts(postIds)

      // Determine success/failure
      const reactionsSuccess = results.find(r => r && 'totalReactions' in r)?.status === 'completed'
      const commentsSuccess = results.find(r => r && 'totalComments' in r)?.status === 'completed'

      progressTracking.updateStep('saving', { id: 'saving', label: 'Completed', status: 'completed' })
      progressTracking.updateProgress(100)
      progressTracking.completeProgress()

      // Set appropriate success/error message
      if (reactionsSuccess && commentsSuccess) {
        const reactionsData = results.find(r => r && 'totalReactions' in r)
        const commentsData = results.find(r => r && 'totalComments' in r)
        setSuccess(`Successfully scraped both reactions (${reactionsData?.totalReactions || 0}) and comments (${commentsData?.totalComments || 0}) for ${selectedPosts.size} posts`)
      } else if (reactionsSuccess || commentsSuccess) {
        const scraped = reactionsSuccess ? 'reactions' : 'comments'
        const failed = reactionsSuccess ? 'comments' : 'reactions'
        setSuccess(`Successfully scraped ${scraped} for ${selectedPosts.size} posts. ${failed} scraping had issues.`)
      } else {
        setError(`Failed to scrape engagements for ${selectedPosts.size} posts`)
      }
      
      setSelectedPosts(new Set()) // Clear selection
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
        { id: 'saving', label: 'Save to database', status: 'pending' }
      ]
      
      progressTracking.startProgress('Scraping Comments', initialSteps, postIds.length)

      // Start the progress-enabled comments scraping
      const response = await fetch('/api/scrape/comments-progress', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ postIds }),
      })

      const result = await response.json()

      if (!response.ok) {
        progressTracking.updateStep('init', {
          id: 'init',
          label: 'Failed to start',
          status: 'error',
          errorMessage: result.error || 'Failed to scrape comments'
        })
        progressTracking.completeProgress()
        throw new Error(result.error || 'Failed to scrape comments')
      }

      // Start polling for progress
      await pollProgress(result.progressId, '/api/scrape/comments-progress')
      
      // Clear selection after successful completion
      setSelectedPosts(new Set())
      
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
            reaction_type,
            scraped_at,
            profiles!inner(
              id,
              name,
              headline,
              profile_url
            )
          `)
          .eq('post_id', post.id)
          .order('scraped_at', { ascending: false })

        if (error) throw error
        
        setEngagementData({ post, type, profiles: data || [] })
      } else {
        const { data, error } = await supabase
          .from('comments')
          .select(`
            comment_text,
            posted_at_date,
            scraped_at,
            profiles!inner(
              id,
              name,
              headline,
              profile_url
            )
          `)
          .eq('post_id', post.id)
          .order('scraped_at', { ascending: false })

        if (error) throw error
        
        setEngagementData({ post, type, profiles: data || [] })
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
      
      progressTracking.startProgress('Fetching Post Metadata', initialSteps, postIds.length)

      // Start the progress-enabled metadata fetching
      const response = await fetch('/api/scrape/post-metadata-progress', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          postIds: postIds,
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        progressTracking.updateStep('init', {
          id: 'init',
          label: 'Failed to start',
          status: 'error',
          errorMessage: result.error || 'Failed to fetch metadata'
        })
        progressTracking.completeProgress()
        throw new Error(result.error || 'Failed to fetch metadata')
      }

      // Start polling for progress
      await pollProgress(result.progressId, '/api/scrape/post-metadata-progress')
      
      // Clear selection after successful completion
      setSelectedPosts(new Set())
      
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
      
      progressTracking.startProgress('Fetching Post Metadata', initialSteps, postIds.length)

      // Start the progress-enabled metadata fetching
      const response = await fetch('/api/scrape/post-metadata-progress', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          postIds: postIds,
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        progressTracking.updateStep('init', {
          id: 'init',
          label: 'Failed to start',
          status: 'error',
          errorMessage: result.error || 'Failed to fetch metadata'
        })
        progressTracking.completeProgress()
        throw new Error(result.error || 'Failed to fetch metadata')
      }

      // Start polling for progress
      await pollProgress(result.progressId, '/api/scrape/post-metadata-progress')
      
    } catch (error) {
      console.error('Error fetching metadata for new posts:', error)
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
        { id: 'saving', label: 'Save to database', status: 'pending' }
      ]
      
      progressTracking.startProgress('Scraping Reactions', initialSteps, postIds.length)

      // Start the progress-enabled reactions scraping
      const response = await fetch('/api/scrape/reactions-progress', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ postIds }),
      })

      const result = await response.json()

      if (!response.ok) {
        progressTracking.updateStep('init', {
          id: 'init',
          label: 'Failed to start',
          status: 'error',
          errorMessage: result.error || 'Failed to scrape reactions'
        })
        progressTracking.completeProgress()
        throw new Error(result.error || 'Failed to scrape reactions')
      }

      // Start polling for progress
      await pollProgress(result.progressId, '/api/scrape/reactions-progress')
      
      // Clear selection after successful completion
      setSelectedPosts(new Set())
      
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
    } catch (error) {
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

      const requestBody: any = {
        profileUrl: values.profileUrl
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
      
      progressTracking.startProgress('Scraping Posts from LinkedIn Profile', initialSteps)

      // Start the progress-enabled scraping
      const response = await fetch('/api/scrape/profile-posts-progress', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      const result = await response.json()

      if (!response.ok) {
        progressTracking.updateStep('init', {
          id: 'init',
          label: 'Failed to start',
          status: 'error',
          errorMessage: result.error || 'Failed to scrape profile posts'
        })
        progressTracking.completeProgress()
        setError(result.error || 'Failed to scrape profile posts')
        return
      }

      // Start polling for progress
      await pollProgress(result.progressId, '/api/scrape/profile-posts-progress')
      
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
  const handleSort = (column: 'posted_at' | 'author_name' | 'scraped_at') => {
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
    
    // Apply engagement filters
    if (showNewEngagementOnly) {
      filtered = filtered.filter(post => 
        post.engagement_needs_scraping === true && 
        (post.last_reactions_scrape || post.last_comments_scrape)
      )
    } else if (showUnscrapedOnly) {
      filtered = filtered.filter(post => 
        !post.last_reactions_scrape || !post.last_comments_scrape
      )
    }
    
    // Apply author filter
    if (authorFilter.trim()) {
      filtered = filtered.filter(post => 
        post.author_name?.toLowerCase().includes(authorFilter.toLowerCase())
      )
    }

    // Then apply sorting
    if (!sortBy) return filtered

    const sorted = [...filtered].sort((a, b) => {
      let valueA: any, valueB: any

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
        default:
          return 0
      }

      if (valueA < valueB) return sortOrder === 'asc' ? -1 : 1
      if (valueA > valueB) return sortOrder === 'asc' ? 1 : -1
      return 0
    })

    return sorted
  }, [posts, sortBy, sortOrder, showNewEngagementOnly, showUnscrapedOnly, authorFilter])

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
                    Enter a LinkedIn profile URL to automatically scrape and add all posts from that profile.
                  </DialogDescription>
                </DialogHeader>
                
                <Form {...profileForm}>
                  <form onSubmit={profileForm.handleSubmit(onProfileSubmit)} className="space-y-4">
                    <FormField
                      control={profileForm.control}
                      name="profileUrl"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>LinkedIn Profile URL</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="https://www.linkedin.com/in/username/"
                              {...field}
                            />
                          </FormControl>
                          <FormDescription>
                            Enter the full LinkedIn profile URL (e.g., https://www.linkedin.com/in/username/)
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
                                  captionLayout="dropdown-buttons" // Compact month/year selection
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
                className="bg-black hover:bg-gray-800 text-white rounded-r-none border-r border-gray-600"
              >
                Scrape Engagements ({selectedPosts.size})
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    disabled={selectedPosts.size === 0 || isSaving}
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
                >
                  Fetch Post Metadata ({selectedPosts.size})
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => handleAction('delete')}
                  disabled={selectedPosts.size === 0}
                >
                  Delete Posts ({selectedPosts.size})
                </Button>
              </>
            )}

            
            <div className="ml-auto flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Filter by author..."
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
              
              <button
                onClick={() => {
                  setShowUnscrapedOnly(!showUnscrapedOnly)
                  if (!showUnscrapedOnly) {
                    setShowNewEngagementOnly(false) // Clear other filter
                    setAuthorFilter('') // Clear author filter
                  }
                }}
                className={`text-sm cursor-pointer transition-colors border-b border-dotted ${
                  showUnscrapedOnly 
                    ? "text-blue-600 border-blue-600" 
                    : "text-gray-600 hover:text-blue-600 border-gray-400 hover:border-blue-600"
                }`}
                title={showUnscrapedOnly ? "Show all posts" : "Show only posts that haven't been fully scraped (missing reactions or comments)"}
              >
                {showUnscrapedOnly ? "Show all posts" : "Show unscraped posts"}
              </button>
              
              <button
                onClick={() => {
                  setShowNewEngagementOnly(!showNewEngagementOnly)
                  if (!showNewEngagementOnly) {
                    setShowUnscrapedOnly(false) // Clear other filter
                    setAuthorFilter('') // Clear author filter
                  }
                }}
                className={`text-sm cursor-pointer transition-colors border-b border-dotted ${
                  showNewEngagementOnly 
                    ? "text-blue-600 border-blue-600" 
                    : "text-gray-600 hover:text-blue-600 border-gray-400 hover:border-blue-600"
                }`}
                title={showNewEngagementOnly ? "Show all posts" : "Show only posts with increased engagement that need re-scraping"}
              >
                {showNewEngagementOnly ? "Show all posts" : "Show posts needing re-scrape"}
              </button>
            </div>
          </div>
        )}

        {/* Posts Table */}
        <Card>
          <CardContent className="p-0">
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
                <p className="text-sm">Click "Add Manually" to get started with LinkedIn engagement analysis</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAndSortedPosts.map((post) => (
                    <TableRow key={post.id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedPosts.has(post.id)}
                          onCheckedChange={() => togglePostSelection(post.id)}
                          aria-label={`Select post ${post.post_id}`}
                        />
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
                          const dates = [lastReactionScrape, lastCommentScrape].filter(Boolean)
                          if (dates.length === 0) return 'Never'
                          
                          const mostRecent = new Date(Math.max(...dates.map(d => d.getTime())))
                          return mostRecent.toLocaleDateString()
                        })()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
                  
                  {(previewPost.reactions_count || previewPost.comments_count) && (
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
                {engagementData?.profiles.length || 0} {engagementData?.type} on Post {engagementData?.post?.post_id}
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
                  {engagementData?.profiles.map((profile: any, index: number) => (
                    <div key={profile.profiles.id || index} className="flex items-start gap-3 p-3 border rounded-lg hover:bg-gray-50">
                      <div className="w-10 h-10 bg-gray-300 rounded-full flex items-center justify-center text-sm font-medium flex-shrink-0">
                        {profile.profiles.name?.charAt(0)?.toUpperCase() || '?'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          {profile.profiles.profile_url ? (
                            <a
                              href={profile.profiles.profile_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium text-blue-600 hover:text-blue-800 hover:underline text-sm truncate"
                            >
                              {profile.profiles.name || 'Unknown'}
                            </a>
                          ) : (
                            <span className="font-medium text-sm truncate">{profile.profiles.name || 'Unknown'}</span>
                          )}
                          {engagementData.type === 'reactions' && profile.reaction_type && (
                            <Badge variant="outline" className="text-xs flex-shrink-0">
                              {profile.reaction_type}
                            </Badge>
                          )}
                        </div>
                        {profile.profiles.headline && (
                          <div className="text-xs text-gray-500 line-clamp-1">
                            {profile.profiles.headline}
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
