'use client'

import { useState, useEffect } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import * as z from 'zod'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { Database } from '@/lib/types/database.types'

type UserSettings = Database['public']['Tables']['user_settings']['Row']

const formSchema = z.object({
  apify_api_key: z.string().min(1, 'Apify API key is required'),
  monitored_profiles: z.string().optional(),
})

export default function SettingsPage() {
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [settings, setSettings] = useState<UserSettings | null>(null)
  const supabase = createClient()

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      apify_api_key: '',
      monitored_profiles: '',
    },
  })

  useEffect(() => {
    loadSettings()
  }, [])

  async function loadSettings() {
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
    } catch (error) {
      setError('Failed to load settings')
    } finally {
      setIsLoading(false)
    }
  }

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
    } catch (error) {
      setError('Failed to save settings')
    } finally {
      setIsSaving(false)
    }
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
                    Last updated: {new Date(settings.updated_at).toLocaleString()}
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
              Add LinkedIn profile URLs that you want to monitor regularly. These profiles will be pre-selected when you use "Scrape from Profile".
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

      </div>
    </div>
  )
}
