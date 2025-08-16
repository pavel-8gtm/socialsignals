'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'

export default function TestApifyPage() {
  const [postUrl, setPostUrl] = useState('https://www.linkedin.com/posts/yurevichcv_how-the-market-sees-it-lower-funnel-activity-7321446486167244800-y6vl')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  async function testApify() {
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const response = await fetch('/api/test-apify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ postUrl }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Test failed')
      }

      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>Test Apify Integration</CardTitle>
            <CardDescription>
              Test the LinkedIn Post Reactions Scraper with your API key
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium">LinkedIn Post URL:</label>
              <Input
                value={postUrl}
                onChange={(e) => setPostUrl(e.target.value)}
                placeholder="https://www.linkedin.com/posts/..."
                className="mt-1"
              />
            </div>

            <Button 
              onClick={testApify} 
              disabled={loading || !postUrl}
              className="w-full"
            >
              {loading ? 'Testing...' : 'Test Apify Scraper'}
            </Button>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {result && (
              <Alert>
                <AlertDescription>
                  <div className="space-y-2">
                    <p className="font-medium text-green-600">✅ {result.message}</p>
                    <p>Reactions found: {result.reactionsFound}</p>
                    {result.sampleReactions && result.sampleReactions.length > 0 && (
                      <div className="mt-4">
                        <p className="font-medium">Sample reactions:</p>
                        <pre className="text-xs bg-gray-100 p-2 rounded mt-2 overflow-x-auto">
                          {JSON.stringify(result.sampleReactions, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
