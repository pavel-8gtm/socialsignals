/**
 * Utility functions for handling LinkedIn post URLs and extracting post IDs
 */

export interface LinkedInPostData {
  postUrl: string
  postId: string | null
  isValid: boolean
  error?: string
}

/**
 * Extract LinkedIn post ID from various URL formats
 * Supports formats like:
 * - https://www.linkedin.com/posts/satyanadella_activity-7302346926123798528
 * - https://www.linkedin.com/posts/activity-7302346926123798528  
 * - https://linkedin.com/posts/username_activity-7302346926123798528
 * - Just the post ID: 7302346926123798528
 */
export function extractLinkedInPostId(input: string): LinkedInPostData {
  const trimmedInput = input.trim()
  
  // If input is empty
  if (!trimmedInput) {
    return {
      postUrl: '',
      postId: null,
      isValid: false,
      error: 'URL cannot be empty'
    }
  }

  // Check if it's already just a post ID (numeric string)
  const postIdRegex = /^\d{19}$/
  if (postIdRegex.test(trimmedInput)) {
    return {
      postUrl: `https://www.linkedin.com/posts/activity-${trimmedInput}`,
      postId: trimmedInput,
      isValid: true
    }
  }

  // Extract from full LinkedIn URL
  const urlPatterns = [
    // Standard format: /posts/username_activity-POSTID (with optional suffix)
    /linkedin\.com\/posts\/[^\/]+_activity-(\d{19})(?:-[a-zA-Z0-9]+)?/,
    // Alternative format: /posts/activity-POSTID (with optional suffix)
    /linkedin\.com\/posts\/activity-(\d{19})(?:-[a-zA-Z0-9]+)?/,
    // Format with title: /posts/username_title-activity-POSTID (with optional suffix)
    /linkedin\.com\/posts\/[^\/]+-activity-(\d{19})(?:-[a-zA-Z0-9]+)?/,
    // Feed format: /feed/update/urn:li:activity:POSTID
    /linkedin\.com\/feed\/update\/urn:li:activity:(\d{19})/,
    // Direct activity format: /in/username/detail/recent-activity/urn:li:activity:POSTID
    /linkedin\.com\/in\/[^\/]+\/detail\/recent-activity\/urn:li:activity:(\d{19})/
  ]

  for (const pattern of urlPatterns) {
    const match = trimmedInput.match(pattern)
    if (match && match[1]) {
      return {
        postUrl: trimmedInput, // Keep the original URL
        postId: match[1],
        isValid: true
      }
    }
  }

  return {
    postUrl: trimmedInput,
    postId: null,
    isValid: false,
    error: 'Invalid LinkedIn post URL format. Please provide a valid LinkedIn post URL or post ID.'
  }
}



/**
 * Validate multiple LinkedIn post URLs/IDs
 */
export function validateLinkedInPosts(input: string): LinkedInPostData[] {
  if (!input.trim()) {
    return []
  }

  // Split by newlines, commas, or spaces and filter empty strings
  const urls = input
    .split(/[\n,\s]+/)
    .map(url => url.trim())
    .filter(url => url.length > 0)

  return urls.map(url => extractLinkedInPostId(url))
}

/**
 * Check if a string looks like a LinkedIn URL
 */
export function isLinkedInUrl(url: string): boolean {
  return url.includes('linkedin.com') || /^\d{19}$/.test(url.trim())
}
