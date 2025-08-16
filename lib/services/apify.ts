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
      
      return items as ApifyReactionData[]
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

      return items[0] as ApifyPostDetailData
    } catch (error) {
      console.error('Error scraping post detail:', error)
      throw new Error(`Failed to scrape post detail: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Get run status
   */
  async getRunStatus(runId: string) {
    try {
      const run = await this.client.run(runId).get()
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
}

export default ApifyService
