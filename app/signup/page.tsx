'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

export default function SignupPage() {
  const router = useRouter()

  useEffect(() => {
    // Redirect to login after a short delay
    const timer = setTimeout(() => {
      router.push('/login')
    }, 3000)

    return () => clearTimeout(timer)
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl font-bold text-center">
            Sign Up Disabled
          </CardTitle>
          <CardDescription className="text-center">
            New account registration is currently disabled
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-gray-600 text-center">
            Please sign in with an existing account. You will be redirected to the login page automatically.
          </p>
          <Button asChild className="w-full">
            <Link href="/login">
              Go to Sign In
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}