import { extractLinkedInPostId, validateLinkedInPosts, isLinkedInUrl } from '../linkedin'

describe('LinkedIn URL parsing', () => {
  describe('extractLinkedInPostId', () => {
    it('should extract post ID from standard LinkedIn URL', () => {
      const result = extractLinkedInPostId('https://www.linkedin.com/posts/satyanadella_activity-7302346926123798528')
      expect(result.isValid).toBe(true)
      expect(result.postId).toBe('7302346926123798528')
      expect(result.postUrl).toBe('https://www.linkedin.com/posts/satyanadella_activity-7302346926123798528')
    })

    it('should extract post ID from LinkedIn URL with suffix', () => {
      const result = extractLinkedInPostId('https://www.linkedin.com/posts/yurevichcv_how-the-market-sees-it-lower-funnel-activity-7321446486167244800-y6vl')
      expect(result.isValid).toBe(true)
      expect(result.postId).toBe('7321446486167244800')
      expect(result.postUrl).toBe('https://www.linkedin.com/posts/yurevichcv_how-the-market-sees-it-lower-funnel-activity-7321446486167244800-y6vl')
    })

    it('should extract post ID from alternative URL format', () => {
      const result = extractLinkedInPostId('https://linkedin.com/posts/activity-7302346926123798528')
      expect(result.isValid).toBe(true)
      expect(result.postId).toBe('7302346926123798528')
      expect(result.postUrl).toBe('https://linkedin.com/posts/activity-7302346926123798528')
    })

    it('should handle just post ID input', () => {
      const result = extractLinkedInPostId('7302346926123798528')
      expect(result.isValid).toBe(true)
      expect(result.postId).toBe('7302346926123798528')
      expect(result.postUrl).toBe('https://www.linkedin.com/posts/activity-7302346926123798528')
    })

    it('should handle feed URL format', () => {
      const result = extractLinkedInPostId('https://www.linkedin.com/feed/update/urn:li:activity:7302346926123798528')
      expect(result.isValid).toBe(true)
      expect(result.postId).toBe('7302346926123798528')
    })

    it('should reject invalid URLs', () => {
      const result = extractLinkedInPostId('https://twitter.com/some-post')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('Invalid LinkedIn post URL format')
    })

    it('should reject empty input', () => {
      const result = extractLinkedInPostId('')
      expect(result.isValid).toBe(false)
      expect(result.error).toBe('URL cannot be empty')
    })

    it('should reject invalid post ID format', () => {
      const result = extractLinkedInPostId('123') // Too short
      expect(result.isValid).toBe(false)
    })
  })

  describe('validateLinkedInPosts', () => {
    it('should validate multiple URLs', () => {
      const input = `https://www.linkedin.com/posts/user1_activity-7302346926123798528
      7302346926123798529
      https://invalid-url.com`
      
      const results = validateLinkedInPosts(input)
      expect(results).toHaveLength(3)
      expect(results[0].isValid).toBe(true)
      expect(results[1].isValid).toBe(true)
      expect(results[2].isValid).toBe(false)
    })

    it('should handle empty input', () => {
      const results = validateLinkedInPosts('')
      expect(results).toHaveLength(0)
    })

    it('should handle comma-separated URLs', () => {
      const input = '7302346926123798528, 7302346926123798529'
      const results = validateLinkedInPosts(input)
      expect(results).toHaveLength(2)
      expect(results[0].isValid).toBe(true)
      expect(results[1].isValid).toBe(true)
    })
  })

  describe('isLinkedInUrl', () => {
    it('should detect LinkedIn URLs', () => {
      expect(isLinkedInUrl('https://linkedin.com/posts/activity-123')).toBe(true)
      expect(isLinkedInUrl('7302346926123798528')).toBe(true)
    })

    it('should reject non-LinkedIn URLs', () => {
      expect(isLinkedInUrl('https://twitter.com/post')).toBe(false)
      expect(isLinkedInUrl('random text')).toBe(false)
    })
  })
})
