'use client'

import { useState, useEffect, useCallback } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import * as z from 'zod'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Plus, Edit, Trash2, ExternalLink } from 'lucide-react'
import type { Database } from '@/lib/types/database.types'

type UserSettings = Database['public']['Tables']['user_settings']['Row']

interface Webhook {
  id: string;
  name: string;
  url: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const formSchema = z.object({
  apify_api_key: z.string().min(1, 'Apify API key is required'),
  monitored_profiles: z.string().optional(),
})

const webhookFormSchema = z.object({
  name: z.string().min(1, 'Webhook name is required').max(100, 'Name too long'),
  url: z.string().url('Invalid URL format'),
  description: z.string().optional(),
  is_active: z.boolean().optional(),
})

export default function SettingsPage() {
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [settings, setSettings] = useState<UserSettings | null>(null)
  
  // Webhook management state
  const [webhooks, setWebhooks] = useState<Webhook[]>([])
  const [isWebhookDialogOpen, setIsWebhookDialogOpen] = useState(false)
  const [editingWebhook, setEditingWebhook] = useState<Webhook | null>(null)
  const [isWebhookLoading, setIsWebhookLoading] = useState(false)
  
  const supabase = createClient()

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      apify_api_key: '',
      monitored_profiles: '',
    },
  })

  const webhookForm = useForm<z.infer<typeof webhookFormSchema>>({
    resolver: zodResolver(webhookFormSchema),
    defaultValues: {
      name: '',
      url: '',
      description: '',
      is_active: true,
    },
  })

  const loadSettings = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setError('Not authenticated')
        return
      }

      const { data, error } = await supabase
        .from('user_settings')
        .select('*')
        .eq('user_id', user.id)
        .single()

      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
        setError(error.message)
      } else if (data) {
        setSettings(data)
        form.setValue('apify_api_key', data.apify_api_key)
        form.setValue('monitored_profiles', (data.monitored_profiles || []).join('\n'))
      }
    } catch {
      setError('Failed to load settings')
    } finally {
      setIsLoading(false)
    }
  }, [form, supabase])

  useEffect(() => {
    loadSettings()
    loadWebhooks()
  }, [loadSettings])

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsSaving(true)
    setError(null)
    setSuccess(null)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setError('Not authenticated')
        return
      }

      // Parse monitored profiles from textarea (one per line)
      const monitoredProfilesArray = values.monitored_profiles
        ? values.monitored_profiles
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
        : []

      const { error } = await supabase
        .from('user_settings')
        .upsert({
          user_id: user.id,
          apify_api_key: values.apify_api_key,
          monitored_profiles: monitoredProfilesArray,
        }, {
          onConflict: 'user_id'
        })

      if (error) {
        setError(error.message)
      } else {
        setSuccess('Settings saved successfully!')
        loadSettings() // Reload to get updated data
      }
    } catch {
      setError('Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  // Webhook management functions
  async function loadWebhooks() {
    try {
      const response = await fetch('/api/webhooks')
      const data = await response.json()
      
      if (response.ok) {
        setWebhooks(data.webhooks || [])
      } else {
        console.error('Failed to load webhooks:', data.error)
      }
    } catch (error) {
      console.error('Error loading webhooks:', error)
    }
  }

  async function handleCreateWebhook(data: z.infer<typeof webhookFormSchema>) {
    setIsWebhookLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      const result = await response.json()

      if (response.ok) {
        setSuccess('Webhook created successfully!')
        setIsWebhookDialogOpen(false)
        webhookForm.reset()
        loadWebhooks()
      } else {
        setError(result.error || 'Failed to create webhook')
      }
    } catch {
      setError('Failed to create webhook')
    } finally {
      setIsWebhookLoading(false)
    }
  }

  async function handleUpdateWebhook(data: z.infer<typeof webhookFormSchema>) {
    if (!editingWebhook) return

    setIsWebhookLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch('/api/webhooks', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingWebhook.id, ...data }),
      })

      const result = await response.json()

      if (response.ok) {
        setSuccess('Webhook updated successfully!')
        setIsWebhookDialogOpen(false)
        setEditingWebhook(null)
        webhookForm.reset()
        loadWebhooks()
      } else {
        setError(result.error || 'Failed to update webhook')
      }
    } catch {
      setError('Failed to update webhook')
    } finally {
      setIsWebhookLoading(false)
    }
  }

  async function handleDeleteWebhook(webhookId: string) {
    if (!confirm('Are you sure you want to delete this webhook?')) return

    setIsWebhookLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch('/api/webhooks', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: webhookId }),
      })

      const result = await response.json()

      if (response.ok) {
        setSuccess('Webhook deleted successfully!')
        loadWebhooks()
      } else {
        setError(result.error || 'Failed to delete webhook')
      }
    } catch {
      setError('Failed to delete webhook')
    } finally {
      setIsWebhookLoading(false)
    }
  }

  function openCreateWebhookDialog() {
    setEditingWebhook(null)
    webhookForm.reset({
      name: '',
      url: '',
      description: '',
      is_active: true,
    })
    setIsWebhookDialogOpen(true)
  }

  function openEditWebhookDialog(webhook: Webhook) {
    setEditingWebhook(webhook)
    webhookForm.reset({
      name: webhook.name,
      url: webhook.url,
      description: webhook.description || '',
      is_active: webhook.is_active,
    })
    setIsWebhookDialogOpen(true)
  }

  if (isLoading) {
    return (
      <div className="container mx-auto py-8 px-4">
        <div className="max-w-2xl mx-auto">
          <div className="space-y-4">
            <div className="h-8 bg-gray-200 rounded animate-pulse"></div>
            <Card>
              <CardHeader>
                <div className="h-6 bg-gray-200 rounded animate-pulse"></div>
                <div className="h-4 bg-gray-200 rounded animate-pulse w-3/4"></div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="h-4 bg-gray-200 rounded animate-pulse"></div>
                  <div className="h-10 bg-gray-200 rounded animate-pulse"></div>
                  <div className="h-10 bg-gray-200 rounded animate-pulse w-24"></div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
          <p className="text-gray-600 mt-2">
            Manage your account settings and API configurations
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Apify API Configuration</CardTitle>
            <CardDescription>
              Your Apify API key is required to scrape LinkedIn data. You can find your API key in your{' '}
              <a 
                href="https://console.apify.com/settings/integrations" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-800 underline"
              >
                Apify Console
              </a>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="apify_api_key"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Apify API Key</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="apify_api_..."
                          type="password"
                          disabled={isSaving}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {error && (
                  <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md">
                    {error}
                  </div>
                )}
                {success && (
                  <div className="p-3 text-sm text-green-600 bg-green-50 border border-green-200 rounded-md">
                    {success}
                  </div>
                )}
                <Button
                  type="submit"
                  disabled={isSaving}
                >
                  {isSaving ? 'Saving...' : 'Save Settings'}
                </Button>
              </form>
            </Form>
            
            {settings && (
              <div className="mt-6 pt-6 border-t">
                <h3 className="text-sm font-medium text-gray-900 mb-2">API Key Status</h3>
                <div className="text-sm text-gray-600">
                  <p>✅ API key configured</p>
                  <p className="text-xs text-gray-500 mt-1">
                    Last updated: {settings.updated_at ? new Date(settings.updated_at).toLocaleString() : 'Never'}
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Monitored LinkedIn Profiles</CardTitle>
            <CardDescription>
              Add LinkedIn profile URLs that you want to monitor regularly. These profiles will be pre-selected when you use &quot;Scrape from Profile&quot;.
              Enter one profile URL per line.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="monitored_profiles"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>LinkedIn Profile URLs</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder={`https://www.linkedin.com/in/john-doe/
https://www.linkedin.com/in/jane-smith/
https://www.linkedin.com/in/example-profile/`}
                          rows={6}
                          disabled={isSaving}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                      <div className="text-sm text-gray-500">
                        Tip: You can copy profile URLs directly from LinkedIn. Both vanity URLs (linkedin.com/in/username) and full URLs with parameters work.
                      </div>
                    </FormItem>
                  )}
                />
                {error && (
                  <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md">
                    {error}
                  </div>
                )}
                {success && (
                  <div className="p-3 text-sm text-green-600 bg-green-50 border border-green-200 rounded-md">
                    {success}
                  </div>
                )}
                <Button
                  type="submit"
                  disabled={isSaving}
                >
                  {isSaving ? 'Saving...' : 'Save Settings'}
                </Button>
              </form>
            </Form>
            
            {settings && settings.monitored_profiles && settings.monitored_profiles.length > 0 && (
              <div className="mt-6 pt-6 border-t">
                <h3 className="text-sm font-medium text-gray-900 mb-2">Current Monitored Profiles</h3>
                <div className="text-sm text-gray-600">
                  <ul className="space-y-1">
                    {settings.monitored_profiles.map((profile, index) => (
                      <li key={index} className="flex items-center gap-2">
                        <span className="text-green-600">✓</span>
                        <a 
                          href={profile} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800 hover:underline truncate"
                        >
                          {profile}
                        </a>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-gray-500 mt-2">
                    {settings.monitored_profiles.length} profile{settings.monitored_profiles.length === 1 ? '' : 's'} configured
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Webhook Management */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Webhooks</CardTitle>
                <CardDescription>
                  Manage webhook endpoints for pushing profile data to external systems
                </CardDescription>
              </div>
              <Dialog open={isWebhookDialogOpen} onOpenChange={setIsWebhookDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" onClick={openCreateWebhookDialog}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Webhook
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>
                      {editingWebhook ? 'Edit Webhook' : 'Create Webhook'}
                    </DialogTitle>
                    <DialogDescription>
                      {editingWebhook 
                        ? 'Update the webhook configuration'
                        : 'Add a new webhook endpoint for pushing profile data'
                      }
                    </DialogDescription>
                  </DialogHeader>
                  <Form {...webhookForm}>
                    <form 
                      onSubmit={webhookForm.handleSubmit(editingWebhook ? handleUpdateWebhook : handleCreateWebhook)}
                      className="space-y-4"
                    >
                      <FormField
                        control={webhookForm.control}
                        name="name"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Name</FormLabel>
                            <FormControl>
                              <Input 
                                placeholder="e.g., CRM System, Analytics Tool"
                                disabled={isWebhookLoading}
                                {...field} 
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={webhookForm.control}
                        name="url"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Webhook URL</FormLabel>
                            <FormControl>
                              <Input 
                                placeholder="https://your-system.com/webhook/profiles"
                                disabled={isWebhookLoading}
                                {...field} 
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={webhookForm.control}
                        name="description"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Description (Optional)</FormLabel>
                            <FormControl>
                              <Textarea 
                                placeholder="Describe what this webhook is used for..."
                                rows={3}
                                disabled={isWebhookLoading}
                                {...field} 
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <div className="flex justify-end gap-2">
                        <Button 
                          type="button" 
                          variant="outline" 
                          onClick={() => setIsWebhookDialogOpen(false)}
                          disabled={isWebhookLoading}
                        >
                          Cancel
                        </Button>
                        <Button type="submit" disabled={isWebhookLoading}>
                          {isWebhookLoading ? (
                            editingWebhook ? 'Updating...' : 'Creating...'
                          ) : (
                            editingWebhook ? 'Update Webhook' : 'Create Webhook'
                          )}
                        </Button>
                      </div>
                    </form>
                  </Form>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent>
            {webhooks.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <div className="mb-4">
                  <ExternalLink className="h-12 w-12 mx-auto text-gray-300" />
                </div>
                <p className="text-lg font-medium">No webhooks configured</p>
                <p className="text-sm">Create your first webhook to start pushing profile data to external systems</p>
              </div>
            ) : (
              <div className="space-y-4">
                {webhooks.map((webhook) => (
                  <div key={webhook.id} className="border rounded-lg p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="font-medium">{webhook.name}</h3>
                          <Badge variant={webhook.is_active ? "default" : "secondary"}>
                            {webhook.is_active ? "Active" : "Inactive"}
                          </Badge>
                        </div>
                        <p className="text-sm text-gray-600 mb-2 break-all">{webhook.url}</p>
                        {webhook.description && (
                          <p className="text-sm text-gray-500 mb-2">{webhook.description}</p>
                        )}
                        <p className="text-xs text-gray-400">
                          Created {new Date(webhook.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex gap-2 ml-4">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditWebhookDialog(webhook)}
                          disabled={isWebhookLoading}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteWebhook(webhook.id)}
                          disabled={isWebhookLoading}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  )
}
