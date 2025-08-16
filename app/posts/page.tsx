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

type Post = Database['public']['Tables']['posts']['Row']

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
  const [confirmAction, setConfirmAction] = useState<'reactions' | 'comments' | 'delete' | null>(null)
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
        .select('*')
        .order('created_at', { ascending: false })

      if (error) {
        setError(error.message)
      } else {
        setPosts(data || [])
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

  function handleAction(action: 'reactions' | 'comments' | 'delete') {
    setConfirmAction(action)
    setShowConfirmDialog(true)
  }

  function confirmActionHandler() {
    if (confirmAction === 'delete') {
      deleteSelectedPosts()
    } else if (confirmAction === 'reactions') {
      // TODO: Implement reactions scraping
      setSuccess(`Reactions scraping started for ${selectedPosts.size} post${selectedPosts.size !== 1 ? 's' : ''}`)
    } else if (confirmAction === 'comments') {
      // TODO: Implement comments scraping
      setSuccess(`Comments scraping started for ${selectedPosts.size} post${selectedPosts.size !== 1 ? 's' : ''}`)
    }
    setShowConfirmDialog(false)
    setConfirmAction(null)
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
                    <TableHead>Post</TableHead>
                    <TableHead>Author</TableHead>
                    <TableHead>Engagement</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Added</TableHead>
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
                      <TableCell>
                        <a
                          href={post.post_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800 font-medium"
                        >
                          {post.post_id}
                        </a>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-gray-600 truncate">
                          {post.author_name || 'Unknown'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-3 text-xs text-gray-500">
                          <span>👍 {post.num_likes || 0}</span>
                          <span>💬 {post.num_comments || 0}</span>
                          <span>🔄 {post.num_shares || 0}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Badge 
                            variant={post.last_reactions_scrape ? "default" : "secondary"} 
                            className="text-xs px-2 py-0"
                          >
                            {post.last_reactions_scrape ? '✓' : '○'} R
                          </Badge>
                          <Badge 
                            variant={post.last_comments_scrape ? "default" : "secondary"} 
                            className="text-xs px-2 py-0"
                          >
                            {post.last_comments_scrape ? '✓' : '○'} C
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-gray-500">
                          {new Date(post.created_at).toLocaleDateString()}
                        </span>
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
              >
                Cancel
              </Button>
              <Button
                onClick={confirmActionHandler}
                variant={confirmAction === 'delete' ? 'destructive' : 'default'}
              >
                {confirmAction === 'delete' ? 'Delete' : 'Confirm'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
