'use client'

import { useState, useEffect } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import * as z from 'zod'
import { createClient } from '@/lib/supabase/client'
import { validateLinkedInPosts, type LinkedInPostData } from '@/lib/utils/linkedin'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { Database } from '@/lib/types/database.types'

type Post = Database['public']['Tables']['posts']['Row'] & {
  reactions_count?: number
  comments_count?: number
}

const formSchema = z.object({
  postUrls: z.string().min(1, 'Please enter at least one LinkedIn post URL or ID'),
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
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [confirmAction, setConfirmAction] = useState<'metadata' | 'reactions' | 'comments' | 'delete' | null>(null)
  const [previewPost, setPreviewPost] = useState<Post | null>(null)
  const [showPreviewDialog, setShowPreviewDialog] = useState(false)
  const [showEngagementDialog, setShowEngagementDialog] = useState(false)
  const [engagementData, setEngagementData] = useState<{ post: Post; type: 'reactions' | 'comments'; profiles: any[] } | null>(null)
  const [loadingEngagement, setLoadingEngagement] = useState(false)
  const supabase = createClient()

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      postUrls: '',
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
    if (selectedPosts.size === posts.length) {
      setSelectedPosts(new Set())
    } else {
      setSelectedPosts(new Set(posts.map(post => post.id)))
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
        // Load comments data
        const { data, error } = await supabase
          .from('comments')
          .select(`
            comment_text,
            posted_at_date,
            is_edited,
            is_pinned,
            total_reactions,
            scraped_at,
            profiles!inner(
              id,
              name,
              headline,
              profile_url
            )
          `)
          .eq('post_id', post.id)
          .order('posted_at_date', { ascending: false })

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
    setIsSaving(true)
    setError(null)
    
    try {
      const response = await fetch('/api/scrape/post-metadata', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          postIds: Array.from(selectedPosts),
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to fetch metadata')
      }

      let successMessage = `Successfully fetched metadata for ${result.totalProcessed} post${result.totalProcessed !== 1 ? 's' : ''}`
      
      if (result.errors && result.errors.length > 0) {
        successMessage += `. Warning: ${result.errors.length} error${result.errors.length !== 1 ? 's' : ''} occurred.`
      }
      
      setSuccess(successMessage)
      setSelectedPosts(new Set()) // Clear selection
      await loadPosts() // Reload posts to show updated data
      
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to fetch metadata')
    } finally {
      setIsSaving(false)
    }
  }

  async function scrapeReactions() {
    setIsSaving(true)
    setError(null)
    
    try {
      const response = await fetch('/api/scrape/reactions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          postIds: Array.from(selectedPosts),
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to scrape reactions')
      }

      let successMessage = `Successfully scraped ${result.totalScraped} reactions from ${result.postsProcessed} post${result.postsProcessed !== 1 ? 's' : ''}`
      
      if (result.errors && result.errors.length > 0) {
        successMessage += `. Warning: ${result.errors.length} error${result.errors.length !== 1 ? 's' : ''} occurred.`
      }
      
      setSuccess(successMessage)
      setSelectedPosts(new Set()) // Clear selection
      await loadPosts() // Reload posts to show updated scrape status
      
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to scrape reactions')
    } finally {
      setIsSaving(false)
    }
  }

  async function scrapeComments() {
    setIsSaving(true)
    setError(null)
    
    try {
      const response = await fetch('/api/scrape/comments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          postIds: Array.from(selectedPosts),
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to scrape comments')
      }

      let successMessage = `Successfully scraped ${result.totalScraped} comments from ${result.postsProcessed} post${result.postsProcessed !== 1 ? 's' : ''}`
      
      if (result.errors && result.errors.length > 0) {
        successMessage += `. Warning: ${result.errors.length} error${result.errors.length !== 1 ? 's' : ''} occurred.`
      }
      
      setSuccess(successMessage)
      setSelectedPosts(new Set()) // Clear selection
      await loadPosts() // Reload posts to show updated scrape status
      
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to scrape comments')
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
          onConflict: 'user_id,post_url',
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
        
        setSuccess(successMessage)
        form.reset()
        setValidationResults([])
        setShowAddDialog(false) // Close the dialog
        await loadPosts() // Reload the posts list
      }
    } catch (error) {
      setError('Failed to add posts')
    } finally {
      setIsSaving(false)
    }
  }

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
          <h1 className="text-2xl font-bold text-gray-900 mb-4">
            Please log in to manage your posts
          </h1>
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
          <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
            <DialogTrigger asChild>
              <Button>Add Posts</Button>
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
            <Button
              variant="outline"
              onClick={() => handleAction('metadata')}
              disabled={selectedPosts.size === 0}
            >
              Fetch Metadata ({selectedPosts.size})
            </Button>
            <Button
              variant="outline"
              onClick={() => handleAction('reactions')}
              disabled={selectedPosts.size === 0}
            >
              Scrape Reactions ({selectedPosts.size})
            </Button>
            <Button
              variant="outline"
              onClick={() => handleAction('comments')}
              disabled={selectedPosts.size === 0}
            >
              Scrape Comments ({selectedPosts.size})
            </Button>
            <Button
              variant="destructive"
              onClick={() => handleAction('delete')}
              disabled={selectedPosts.size === 0}
            >
              Delete Posts ({selectedPosts.size})
            </Button>
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
                <p className="text-sm">Click "Add Posts" to get started with LinkedIn engagement analysis</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
                      <Checkbox
                        checked={selectedPosts.size === posts.length && posts.length > 0}
                        onCheckedChange={toggleSelectAll}
                        aria-label="Select all posts"
                      />
                    </TableHead>
                    <TableHead>Content</TableHead>
                    <TableHead>Published</TableHead>
                    <TableHead>Author</TableHead>
                    <TableHead>Engagement</TableHead>
                    <TableHead>Scraped</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {posts.map((post) => (
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
                          <a
                            href={post.post_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-800 font-medium text-sm flex-shrink-0"
                          >
                            Post {post.post_id}
                          </a>
                          {post.post_text && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-5 px-2 text-xs flex-shrink-0"
                              onClick={() => {
                                setPreviewPost(post)
                                setShowPreviewDialog(true)
                              }}
                            >
                              Preview
                            </Button>
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
                          {engagementData.type === 'comments' && profile.posted_at_date && (
                            <span className="text-xs text-gray-500 flex-shrink-0">
                              {new Date(profile.posted_at_date).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                        {profile.profiles.headline && (
                          <div className="text-xs text-gray-500 line-clamp-1 mb-1">
                            {profile.profiles.headline}
                          </div>
                        )}
                        {engagementData.type === 'comments' && profile.comment_text && (
                          <div className="text-sm text-gray-700 bg-gray-50 p-2 rounded text-left">
                            {profile.comment_text}
                          </div>
                        )}
                        {engagementData.type === 'comments' && (
                          <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                            {profile.is_edited && (
                              <Badge variant="secondary" className="text-xs">
                                Edited
                              </Badge>
                            )}
                            {profile.is_pinned && (
                              <Badge variant="secondary" className="text-xs">
                                Pinned
                              </Badge>
                            )}
                            {profile.total_reactions > 0 && (
                              <span>{profile.total_reactions} reaction{profile.total_reactions !== 1 ? 's' : ''}</span>
                            )}
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
      </div>
    </div>
  )
}
