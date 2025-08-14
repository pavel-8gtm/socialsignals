'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function SupabaseTest() {
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'error'>('connecting')
  const [user, setUser] = useState<any>(null)

  useEffect(() => {
    const supabase = createClient()

    // Test connection by getting the current user
    const checkConnection = async () => {
      try {
        const { data: { user }, error } = await supabase.auth.getUser()
        if (error) {
          console.error('Error connecting to Supabase:', error)
          setConnectionStatus('error')
        } else {
          setConnectionStatus('connected')
          setUser(user)
        }
      } catch (err) {
        console.error('Error:', err)
        setConnectionStatus('error')
      }
    }

    checkConnection()
  }, [])

  return (
    <div className="min-h-screen p-8 font-sans">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Supabase Integration Test</h1>
        
        <div className="bg-gray-50 dark:bg-gray-800 p-6 rounded-lg mb-6">
          <h2 className="text-xl font-semibold mb-4">Connection Status</h2>
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${
              connectionStatus === 'connecting' ? 'bg-yellow-500' :
              connectionStatus === 'connected' ? 'bg-green-500' : 'bg-red-500'
            }`}></div>
            <span className="capitalize">{connectionStatus}</span>
          </div>
        </div>

        <div className="bg-gray-50 dark:bg-gray-800 p-6 rounded-lg mb-6">
          <h2 className="text-xl font-semibold mb-4">User Authentication</h2>
          {user ? (
            <div>
              <p className="text-green-600 font-medium">User is authenticated</p>
              <p className="text-sm text-gray-600 mt-2">User ID: {user.id}</p>
              <p className="text-sm text-gray-600">Email: {user.email}</p>
            </div>
          ) : (
            <p className="text-gray-600">No authenticated user</p>
          )}
        </div>

        <div className="bg-blue-50 dark:bg-blue-900/20 p-6 rounded-lg">
          <h2 className="text-xl font-semibold mb-4">Next Steps</h2>
          <ol className="list-decimal list-inside space-y-2 text-sm">
            <li>Update your <code className="bg-gray-200 dark:bg-gray-700 px-2 py-1 rounded">.env.local</code> file with your actual Supabase URL and keys</li>
            <li>Start your Supabase project locally with <code className="bg-gray-200 dark:bg-gray-700 px-2 py-1 rounded">supabase start</code></li>
            <li>Create your database tables and schemas</li>
            <li>Implement authentication and data operations</li>
          </ol>
        </div>
      </div>
    </div>
  )
}
