import Link from "next/link"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

export default async function Home() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // If user is authenticated, redirect to posts page
  if (user) {
    redirect('/posts')
  }
  return (
    <div className="container mx-auto py-12 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Hero Section */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            LinkedIn Engagement Analytics
          </h1>
          <p className="text-xl text-gray-600 mb-8">
            Scrape and analyze LinkedIn post engagement data to understand your audience better
          </p>
          <div className="flex justify-center gap-4">
            <Button asChild size="lg">
              <Link href="/signup">Get Started</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/login">Sign In</Link>
            </Button>
          </div>
        </div>

        {/* Features Grid */}
        <div className="grid md:grid-cols-3 gap-6 mb-12">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                📊 Post Analytics
              </CardTitle>
              <CardDescription>
                Track engagement metrics for your LinkedIn posts
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600">
                Monitor likes, comments, and shares across all your posts with detailed timestamps and engagement patterns.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                👥 Audience Insights
              </CardTitle>
              <CardDescription>
                Understand who engages with your content
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600">
                Analyze profiles of people who react and comment on your posts to identify your most engaged audience.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                🔍 Automated Scraping
              </CardTitle>
              <CardDescription>
                Powered by Apify for reliable data collection
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600">
                Automatically collect engagement data from your LinkedIn posts with professional-grade scraping technology.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* How it Works */}
        <Card>
          <CardHeader>
            <CardTitle>How It Works</CardTitle>
            <CardDescription>
              Simple steps to start analyzing your LinkedIn engagement
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-4 gap-6">
              <div className="text-center">
                <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold mb-3 mx-auto">
                  1
                </div>
                <h3 className="font-semibold mb-2">Sign Up</h3>
                <p className="text-sm text-gray-600">
                  Create your account and configure your Apify API key
                </p>
              </div>
              <div className="text-center">
                <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold mb-3 mx-auto">
                  2
                </div>
                <h3 className="font-semibold mb-2">Add Posts</h3>
                <p className="text-sm text-gray-600">
                  Add LinkedIn post URLs you want to analyze
                </p>
              </div>
              <div className="text-center">
                <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold mb-3 mx-auto">
                  3
                </div>
                <h3 className="font-semibold mb-2">Scrape Data</h3>
                <p className="text-sm text-gray-600">
                  Automatically collect reactions and comments
                </p>
              </div>
              <div className="text-center">
                <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold mb-3 mx-auto">
                  4
                </div>
                <h3 className="font-semibold mb-2">Analyze</h3>
                <p className="text-sm text-gray-600">
                  View insights and track engagement patterns
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}