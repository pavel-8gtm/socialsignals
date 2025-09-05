import { ApifyClient } from 'apify-client'

// Types based on the Apify LinkedIn Post Reactions Scraper output
export interface ApifyReactionData {
  reaction_type: string
  reactor: {
    urn: string
    name: string
    headline: string
    profile_url: string
    profile_pictures: {
      small: string
      medium: string
      large: string
      original: string
    }
  }
  _metadata: {
    post_url: string
    page_number: number
    reaction_type: string
    total_reactions?: number
  }
}

export interface ApifyRunResult {
  id: string
  status: string
  defaultDatasetId: string
}

export interface ScrapeReactionsParams {
  postUrl: string
  pageNumber?: number
  reactionType?: 'ALL' | 'LIKE' | 'PRAISE' | 'EMPATHY' | 'APPRECIATION' | 'INTEREST'
  limit?: number
}

export interface ApifyPostDetailData {
  post: {
    id: string
    url: string
    created_at: {
      timestamp: number
      date: string
      relative: string
    }
    text: string
    type: string
  }
  author: {
    name: string
    headline: string
    profile_url: string
    profile_picture: string
    followers?: number
    company_id?: string
  }
  media?: Array<{
    type: string
    url?: string
    duration?: number
    thumbnail?: string
  }>
  stats: {
    total_reactions: number
    reactions: {
      like: number
      appreciation: number
      empathy: number
      interest: number
      praise: number
      entertainment: number
    }
    comments: number
    shares: number
  }
}

// Types based on the Apify LinkedIn Post Comments Scraper output
export interface ApifyCommentData {
  comment_id: string
  text: string
  posted_at: {
    timestamp: number
    date: string
    relative: string
  }
  is_edited: boolean
  is_pinned: boolean
  comment_url: string
  author: {
    name: string
    headline: string
    profile_url: string
    profile_picture: string
  }
  stats: {
    total_reactions: number
    reactions: {
      like: number
      appreciation: number
      empathy: number
      interest: number
      praise: number
    }
    comments: number
  }
  replies: unknown[] // Can contain nested comment structures
  post_input: string
  totalComments: number
  _metadata?: {
    post_url: string
    page_number: number
  }
}

export interface ScrapeCommentsParams {
  postIds: string[]
  pageNumber?: number
}

// Types for LinkedIn Profile Enrichment
export interface ApifyProfileEnrichmentData {
  basic_info: {
    fullname: string
    first_name: string
    last_name: string
    headline: string
    public_identifier: string
    profile_picture_url: string
    about: string
    location: {
      country: string
      city: string
      full: string
      country_code: string
    }
    urn: string
    follower_count: number
    connection_count: number
    current_company: string
    current_company_urn: string
    current_company_url: string
    email: string | null
  }
  experience: Array<{
    title: string
    company: string
    location: string
    description: string
    duration: string
    start_date: {
      year: number
      month: string
    }
    end_date?: {
      year: number
      month: string
    }
    is_current: boolean
    company_linkedin_url: string
    company_logo_url: string
    company_id: string
  }>
  education: Array<{
    school: string
    degree: string
    degree_name: string
    field_of_study?: string
    duration: string
    school_linkedin_url: string
    school_logo_url: string
    start_date: {
      year: number
    }
    end_date: {
      year: number
    }
    school_id: string
  }>
  languages: Array<{
    language: string
    proficiency: string
  }>
  profileUrl: string
}

export interface EnrichProfilesParams {
  profileIdentifiers: string[] // LinkedIn profile identifiers (not full URLs)
  includeEmail?: boolean
}

// Types for LinkedIn Profile Posts scraper (based on instructions.md)
export interface ApifyProfilePostData {
  type: string
  isActivity: boolean
  urn: string
  url: string
  timeSincePosted: string
  shareUrn: string
  text: string
  comments: Array<Record<string, unknown>>
  reactions: Array<Record<string, unknown>>
  numShares: number
  numLikes: number
  numComments: number
  author: {
    firstName: string
    lastName: string
    occupation: string
    id: string
    publicId: string
    profileId: string
    picture: string
  }
  authorProfileId: string
  authorName: string
  authorProfileUrl: string
  postedAtTimestamp: number
  postedAtISO: string
  inputUrl: string
}

export interface ScrapeProfilePostsParams {
  profileUrl: string
  scrapeUntilDate?: string // ISO date string
  maxPosts?: number
}

export class ApifyService {
  private client: ApifyClient

  constructor(apiToken: string) {
    this.client = new ApifyClient({
      token: apiToken,
    })
  }

  /**
   * Scrape reactions for a LinkedIn post
   */
  async scrapePostReactions(params: ScrapeReactionsParams): Promise<ApifyReactionData[]> {
    const input = {
      post_url: params.postUrl,
      page_number: params.pageNumber || 1,
      reaction_type: params.reactionType || 'ALL',
      limit: params.limit || 50
    }

    try {
      // Run the LinkedIn Post Reactions Scraper
      const run = await this.client.actor('apimaestro/linkedin-post-reactions').call(input)
      
      if (run.status !== 'SUCCEEDED') {
        throw new Error(`Apify run failed with status: ${run.status}`)
      }

      // Fetch results from the dataset
      const { items } = await this.client.dataset(run.defaultDatasetId).listItems()
      
      return items as unknown as ApifyReactionData[]
    } catch (error) {
      console.error('Error scraping reactions:', error)
      throw new Error(`Failed to scrape reactions: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Scrape all reactions for a post with pagination
   */
  async scrapeAllPostReactions(postUrl: string): Promise<ApifyReactionData[]> {
    const allReactions: ApifyReactionData[] = []
    let pageNumber = 1
    let hasMorePages = true

    while (hasMorePages) {
      try {
        const reactions = await this.scrapePostReactions({
          postUrl,
          pageNumber,
          limit: 100 // Maximum per page
        })

        if (reactions.length === 0) {
          hasMorePages = false
        } else {
          allReactions.push(...reactions)
          
          // Smart pagination: if first page shows total_reactions < 100, no need for more pages
          if (pageNumber === 1 && reactions.length > 0 && reactions[0]._metadata?.total_reactions) {
            const totalReactions = reactions[0]._metadata.total_reactions
            if (totalReactions <= 100) {
              console.log(`Post has only ${totalReactions} total reactions, stopping pagination`)
              hasMorePages = false
              break
            }
          }
          
          pageNumber++
          
          // Safety check to prevent infinite loops
          if (pageNumber > 50) { // Max 5000 reactions (50 pages * 100 per page)
            console.warn(`Reached maximum page limit for post: ${postUrl}`)
            hasMorePages = false
          }
        }
      } catch (error) {
        console.error(`Error scraping page ${pageNumber} for post ${postUrl}:`, error)
        hasMorePages = false
      }
    }

    return allReactions
  }

  /**
   * Scrape reactions for multiple posts concurrently (much faster!)
   */
  async scrapeAllPostReactionsConcurrent(postUrls: string[], concurrencyLimit: number = 32): Promise<ApifyReactionData[]> {
    const allReactions: ApifyReactionData[] = []
    
    // Process posts in batches to respect concurrency limits
    for (let i = 0; i < postUrls.length; i += concurrencyLimit) {
      const batch = postUrls.slice(i, i + concurrencyLimit)
      
      const batchPromises = batch.map(async (postUrl) => {
        try {
          return await this.scrapeAllPostReactions(postUrl)
        } catch (error) {
          console.error(`Error scraping reactions for ${postUrl}:`, error)
          return []
        }
      })
      
      const batchResults = await Promise.allSettled(batchPromises)
      
      batchResults.forEach((result) => {
        if (result.status === 'fulfilled') {
          allReactions.push(...result.value)
        }
      })
    }
    
    return allReactions
  }

  /**
   * Scrape post details and metadata
   */
  async scrapePostDetail(postUrl: string): Promise<ApifyPostDetailData> {
    const input = {
      post_url: postUrl
    }

    try {
      // Run the LinkedIn Post Detail Scraper
      const run = await this.client.actor('apimaestro/linkedin-post-detail').call(input)
      
      if (run.status !== 'SUCCEEDED') {
        throw new Error(`Apify run failed with status: ${run.status}`)
      }

      // Fetch results from the dataset
      const { items } = await this.client.dataset(run.defaultDatasetId).listItems()
      
      if (!items || items.length === 0) {
        throw new Error('No post data returned from scraper')
      }

      return items[0] as unknown as ApifyPostDetailData
    } catch (error) {
      console.error('Error scraping post detail:', error)
      throw new Error(`Failed to scrape post detail: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Scrape comments for LinkedIn posts
   */
  async scrapePostComments(params: ScrapeCommentsParams): Promise<ApifyCommentData[]> {
    const input = {
      postIds: params.postIds,
      page_number: params.pageNumber || 1
    }

    console.log('🐛 DEBUG: About to call Apify comments actor with input:', JSON.stringify(input, null, 2))

    try {
      // Run the LinkedIn Post Comments Scraper
      console.log('🐛 DEBUG: Calling Apify actor apimaestro/linkedin-post-comments-replies-engagements-scraper-no-cookies')
      const run = await this.client.actor('apimaestro/linkedin-post-comments-replies-engagements-scraper-no-cookies').call(input)
      console.log('🐛 DEBUG: Apify run completed with status:', run.status, 'Run ID:', run.id)
      
      if (run.status !== 'SUCCEEDED') {
        throw new Error(`Apify run failed with status: ${run.status}`)
      }

      // Fetch results from the dataset
      const { items } = await this.client.dataset(run.defaultDatasetId).listItems()
      
      return items as unknown as ApifyCommentData[]
    } catch (error) {
      console.error('Error scraping comments:', error)
      throw new Error(`Failed to scrape comments: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Scrape all comments for posts with smart pagination
   * First does bulk call in batches of 100 posts, then paginate only posts with totalComments > 100
   */
  async scrapeAllPostComments(postUrls: string[]): Promise<ApifyCommentData[]> {
    console.log('🐛 DEBUG: scrapeAllPostComments called with postUrls:', postUrls.length, 'posts')
    
    try {
      // Step 1: Batch posts into groups of 100 (Apify limit) and process in bulk
      const batchSize = 100
      const batches: string[][] = []
      
      for (let i = 0; i < postUrls.length; i += batchSize) {
        batches.push(postUrls.slice(i, i + batchSize))
      }
      
      console.log(`🐛 DEBUG: Step 1 - Processing ${batches.length} batches of up to ${batchSize} posts each`)
      
      const allBulkComments: ApifyCommentData[] = []
      const allBulkResponses: Array<Record<string, unknown>> = []
      
      // Process all batches concurrently (up to 32 concurrent Apify runs)
      console.log(`🐛 DEBUG: Starting ${batches.length} concurrent batch calls`)
      
      const batchPromises = batches.map(async (batch, batchIndex) => {
        console.log(`🐛 DEBUG: Starting batch ${batchIndex + 1}/${batches.length} with ${batch.length} posts`)
        
        try {
          const batchResponse = await this.scrapePostComments({
            postIds: batch,
            pageNumber: 1
          })
          
          // Filter out summary objects and get actual comments
          const batchComments = batchResponse.filter(item => 
            item && typeof item === 'object' && 'comment_id' in item
          ) as ApifyCommentData[]
          
          console.log(`🐛 DEBUG: Batch ${batchIndex + 1} completed: ${batchComments.length} comments for ${batch.length} posts`)
          
          return {
            comments: batchComments,
            responses: batchResponse,
            batchIndex: batchIndex + 1
          }
        } catch (error) {
          console.error(`🐛 DEBUG: Batch ${batchIndex + 1} failed:`, error)
          return {
            comments: [],
            responses: [],
            batchIndex: batchIndex + 1,
            error
          }
        }
      })
      
      // Wait for all batches to complete
      const batchResults = await Promise.allSettled(batchPromises)
      
      // Process results
      batchResults.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
          allBulkComments.push(...result.value.comments)
          allBulkResponses.push(...(result.value.responses as Array<Record<string, unknown>>))
        } else {
          console.error(`🐛 DEBUG: Batch ${index + 1} failed:`, result.status === 'rejected' ? result.reason : 'Unknown error')
        }
      })

      console.log(`🐛 DEBUG: All batches complete - found ${allBulkComments.length} comments for ${postUrls.length} posts`)

      // Step 2: Identify posts that have more than 100 comments (need pagination)
      const postsNeedingPagination: string[] = []
      const commentCounts = new Map<string, number>()
      
      // Check totalComments from all batch responses to find posts needing pagination
      allBulkResponses.forEach(item => {
        if (item && typeof item === 'object' && 'totalComments' in item && 'post_input' in item) {
          const totalComments = (item as Record<string, unknown>).totalComments as number
          const postUrl = (item as Record<string, unknown>).post_input as string
          
          if (totalComments > 100) {
            postsNeedingPagination.push(postUrl)
            commentCounts.set(postUrl, totalComments)
          }
        }
      })

      console.log(`🐛 DEBUG: Found ${postsNeedingPagination.length} posts needing pagination (>100 comments each)`)
      
      // Step 3: Paginate through posts that have more than 100 comments
      const paginatedComments: ApifyCommentData[] = []
      const processedPosts = new Set<string>() // Track processed posts to prevent infinite loops
      
      for (const postUrl of postsNeedingPagination) {
        // Skip if already processed (prevent infinite loops)
        if (processedPosts.has(postUrl)) {
          console.log(`🐛 DEBUG: Skipping already processed post: ${postUrl}`)
          continue
        }
        
        processedPosts.add(postUrl)
        const totalComments = commentCounts.get(postUrl) || 0
        console.log(`🐛 DEBUG: Paginating post with ${totalComments} total comments: ${postUrl}`)
        
        // Start from page 2 since we already have page 1 from bulk call
        let pageNumber = 2
        let hasMorePages = true
        let commentsCollectedForPost = 0
        
        while (hasMorePages) {
          try {
            console.log(`🐛 DEBUG: Fetching page ${pageNumber} for post with ${totalComments} comments`)
            const pageResponse = await this.scrapePostComments({
              postIds: [postUrl], // Single post for pagination
              pageNumber
            })

            const pageComments = pageResponse.filter(item => 
              item && typeof item === 'object' && 'comment_id' in item
            ) as ApifyCommentData[]

            if (pageComments.length === 0) {
              console.log(`🐛 DEBUG: No more comments on page ${pageNumber}, stopping pagination for this post`)
              hasMorePages = false
            } else {
              console.log(`🐛 DEBUG: Page ${pageNumber}: Found ${pageComments.length} additional comments`)
              paginatedComments.push(...pageComments)
              commentsCollectedForPost += pageComments.length
              pageNumber++
              
              // Safety checks to prevent infinite loops
              const expectedPages = Math.ceil(totalComments / 100)
              if (pageNumber > expectedPages + 2) { // +2 for extra safety
                console.log(`🐛 DEBUG: Reached safety page limit (${expectedPages + 2}) for post with ${totalComments} comments`)
                hasMorePages = false
              }
              
              // If we've collected enough comments, stop
              if (commentsCollectedForPost >= totalComments - 100) { // -100 because page 1 was from bulk
                console.log(`🐛 DEBUG: Collected enough comments (${commentsCollectedForPost} additional) for post with ${totalComments} total`)
                hasMorePages = false
              }
              
              // Absolute safety limit
              if (pageNumber > 10) {
                console.log(`🐛 DEBUG: Absolute safety limit reached (page 10) for post: ${postUrl}`)
                hasMorePages = false
              }
            }
          } catch (error) {
            console.error(`🐛 DEBUG: Error on page ${pageNumber} for post ${postUrl}:`, error)
            hasMorePages = false
          }
        }
        
        console.log(`🐛 DEBUG: Completed pagination for post: ${commentsCollectedForPost} additional comments collected`)
      }

      // Step 4: Combine bulk comments with paginated comments
      const allComments = [...allBulkComments, ...paginatedComments]
      
      console.log(`🐛 DEBUG: Smart pagination complete:`)
      console.log(`  - Bulk comments: ${allBulkComments.length}`)
      console.log(`  - Paginated comments: ${paginatedComments.length}`)
      console.log(`  - Total comments: ${allComments.length}`)
      
      // Add metadata for tracking
      const commentsWithMetadata = allComments.map((comment, index) => ({
        ...comment,
        _metadata: {
          post_url: comment.post_input,
          page_number: index < allBulkComments.length ? 1 : 2 // Approximate page tracking
        }
      }))
      
      return commentsWithMetadata
    } catch (error) {
      console.error(`Error in smart comments scraping for ${postUrls.length} posts:`, error)
      throw error
    }
  }

  /**
   * Scrape posts from a LinkedIn profile
   */
  async scrapeProfilePosts(params: ScrapeProfilePostsParams): Promise<ApifyProfilePostData[]> {
    const input: Record<string, unknown> = {
      deepScrape: false,
      rawData: false,
      urls: [params.profileUrl]
    }

    // Add max posts limit only if provided by user
    if (params.maxPosts) {
      input.limitPerSource = params.maxPosts
    }

    // Add scrape until date if provided
    if (params.scrapeUntilDate) {
      input.scrapeUntil = params.scrapeUntilDate
    }

    try {
      // Run the LinkedIn Profile Posts Scraper using the actor ID
      const run = await this.client.actor('Wpp1BZ6yGWjySadk3').call(input)
      
      if (run.status !== 'SUCCEEDED') {
        throw new Error(`Apify run failed with status: ${run.status}`)
      }

      // Fetch results from the dataset
      const { items } = await this.client.dataset(run.defaultDatasetId).listItems()
      
      return items as unknown as ApifyProfilePostData[]
    } catch (error) {
      console.error('Error scraping profile posts:', error)
      throw new Error(`Failed to scrape profile posts: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Get run status
   */
  async getRunStatus(runId: string) {
    try {
      const run = await this.client.run(runId).get()
      if (!run) {
        throw new Error('Run not found')
      }
      return {
        id: run.id,
        status: run.status,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        stats: run.stats
      }
    } catch (error) {
      console.error('Error getting run status:', error)
      throw error
    }
  }

  /**
   * Enrich LinkedIn profiles using the LinkedIn Profile Enrichment actor
   * Batches up to 100 profiles per run for efficiency
   */
  async enrichProfiles(params: EnrichProfilesParams): Promise<ApifyProfileEnrichmentData[]> {
    const input = {
      includeEmail: params.includeEmail || false,
      usernames: params.profileIdentifiers
    }

    try {
      const run = await this.client.actor('GOvL4O4RwFqsdIqXF').start({
        ...input,
        memoryMbytes: 1024,
        timeoutSecs: 300
      })

      await this.client.run(run.id).waitForFinish()
      const { items } = await this.client.dataset(run.defaultDatasetId).listItems()

      return (items as unknown) as ApifyProfileEnrichmentData[]
    } catch (error) {
      console.error('Error enriching profiles:', error)
      throw error
    }
  }

  /**
   * Process multiple batches of profile enrichment concurrently
   * Handles batching (50 profiles per run) and concurrency (32 concurrent runs)
   */
  async enrichAllProfiles(
    profileIdentifiers: string[], 
    includeEmail: boolean = false,
    onProgress?: (current: number, total: number, message: string) => void
  ): Promise<ApifyProfileEnrichmentData[]> {
    const BATCH_SIZE = 50
    const MAX_CONCURRENT = 32

    // Split profile identifiers into batches
    const batches: string[][] = []
    for (let i = 0; i < profileIdentifiers.length; i += BATCH_SIZE) {
      batches.push(profileIdentifiers.slice(i, i + BATCH_SIZE))
    }

    console.log(`🐛 DEBUG: Enriching ${profileIdentifiers.length} profiles in ${batches.length} batches`)

    const allEnrichedProfiles: ApifyProfileEnrichmentData[] = []
    let processedBatches = 0

    // Process batches in chunks of MAX_CONCURRENT
    for (let i = 0; i < batches.length; i += MAX_CONCURRENT) {
      const currentBatches = batches.slice(i, i + MAX_CONCURRENT)
      
      onProgress?.(
        processedBatches, 
        batches.length, 
        `Processing batches ${i + 1}-${Math.min(i + MAX_CONCURRENT, batches.length)} of ${batches.length}...`
      )

      // Process current batch chunk concurrently
      const batchPromises = currentBatches.map(async (batch) => {
        try {
          return await this.enrichProfiles({
            profileIdentifiers: batch,
            includeEmail
          })
        } catch (error) {
          console.error('Batch enrichment failed:', error)
          return [] // Return empty array for failed batches
        }
      })

      const results = await Promise.allSettled(batchPromises)
      
      // Collect successful results
      results.forEach((result) => {
        if (result.status === 'fulfilled') {
          allEnrichedProfiles.push(...result.value)
        }
      })

      processedBatches += currentBatches.length
    }

    console.log(`🐛 DEBUG: Profile enrichment complete: ${allEnrichedProfiles.length} profiles enriched`)

    return allEnrichedProfiles
  }
}

export default ApifyService
