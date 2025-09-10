import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

class ApifyService {
  apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async scrapePostReactionsSingle(postUrl: string, pageNumber = 1) {
    const runInput = {
      post_url: postUrl,
      page_number: pageNumber
    };

    console.log(`⚡ REACTIONS v17 - Scraping page ${pageNumber} for post: ${postUrl}`);
    console.log(`⚡ REACTIONS v17 - Apify input:`, JSON.stringify(runInput, null, 2));

    try {
      const response = await fetch('https://api.apify.com/v2/acts/apimaestro~linkedin-post-reactions/runs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          ...runInput,
          timeout: 300
        })
      });

      if (!response.ok) {
        throw new Error(`Apify API error: ${response.status} ${response.statusText}`);
      }

      const runData = await response.json();
      console.log(`⚡ REACTIONS v17 - Apify run created: ${runData.data.id}`);

      // Wait for completion
      let run = runData.data;
      const maxWaitTime = 30 * 60 * 1000; // 30 minutes
      const startTime = Date.now();

      while (run.status === 'RUNNING' || run.status === 'READY') {
        if (Date.now() - startTime > maxWaitTime) {
          throw new Error('Apify run timeout after 30 minutes');
        }

        await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds

        const statusResponse = await fetch(`https://api.apify.com/v2/acts/apimaestro~linkedin-post-reactions/runs/${run.id}`, {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`
          }
        });

        if (!statusResponse.ok) {
          throw new Error(`Failed to check run status: ${statusResponse.statusText}`);
        }

        const statusData = await statusResponse.json();
        run = statusData.data;
        console.log(`⚡ REACTIONS v17 - Run ${run.id} status: ${run.status}`);
      }

      if (run.status !== 'SUCCEEDED') {
        throw new Error(`Apify run failed with status: ${run.status}`);
      }

      // Fetch results
      const resultsResponse = await fetch(`https://api.apify.com/v2/datasets/${run.defaultDatasetId}/items`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });

      if (!resultsResponse.ok) {
        throw new Error(`Failed to fetch results: ${resultsResponse.statusText}`);
      }

      const results = await resultsResponse.json();
      console.log(`⚡ REACTIONS v17 - Got ${results.length} items from page ${pageNumber}`);

      // Filter reactions using correct field name 'reactor' instead of 'author'
      const reactions = results.filter(item => 
        item && 
        typeof item === 'object' && 
        'reaction_type' in item && 
        item.reactor?.profile_url
      );

      console.log(`⚡ REACTIONS v17 - Filtered to ${reactions.length} actual reactions from page ${pageNumber}`);
      return reactions;

    } catch (error) {
      console.error(`⚡ REACTIONS v17 - Error scraping page ${pageNumber}:`, error);
      throw error;
    }
  }

  async scrapeAllPostReactionsConcurrent(postUrls: string[]) {
    console.log(`⚡ REACTIONS v17 - Starting smart concurrent pagination for ${postUrls.length} posts`);
    const allReactions: any[] = [];
    const concurrencyLimit = 2; // Process max 2 posts simultaneously

    // Process posts in batches with concurrency limit
    for (let i = 0; i < postUrls.length; i += concurrencyLimit) {
      const batch = postUrls.slice(i, i + concurrencyLimit);
      console.log(`⚡ REACTIONS v17 - Processing batch ${Math.floor(i / concurrencyLimit) + 1}/${Math.ceil(postUrls.length / concurrencyLimit)} with ${batch.length} posts`);

      const batchPromises = batch.map(async (postUrl) => {
        try {
          // Step 1: Get first page to determine total reactions
          console.log(`⚡ REACTIONS v17 - Getting page 1 for post: ${postUrl}`);
          const firstPageReactions = await this.scrapePostReactionsSingle(postUrl, 1);

          // Extract total reactions from metadata of first page
          let totalReactions = 0;
          if (firstPageReactions.length > 0 && firstPageReactions[0]._metadata?.total_reactions) {
            totalReactions = firstPageReactions[0]._metadata.total_reactions;
          }

          console.log(`⚡ REACTIONS v17 - Post ${postUrl} has ${totalReactions} total reactions (got ${firstPageReactions.length} from page 1)`);

          let allReactionsForPost = [...firstPageReactions];

          // Step 2: If more than 100 reactions, launch additional pages concurrently
          if (totalReactions > 100) {
            const numPagesNeeded = Math.ceil(totalReactions / 100);
            const maxPages = Math.min(numPagesNeeded, 10); // Safety limit: max 10 pages (1000 reactions)

            console.log(`⚡ REACTIONS v17 - Post needs ${numPagesNeeded} pages total, launching ${maxPages - 1} additional pages concurrently`);

            if (maxPages > 1) {
              // Create promises for pages 2, 3, 4, etc. and launch them all at once
              const additionalPagePromises = [];
              for (let pageNum = 2; pageNum <= maxPages; pageNum++) {
                additionalPagePromises.push(this.scrapePostReactionsSingle(postUrl, pageNum));
              }

              // Wait for all additional pages to complete concurrently
              console.log(`⚡ REACTIONS v17 - Launching ${additionalPagePromises.length} concurrent page jobs for post ${postUrl}`);
              const additionalPagesResults = await Promise.all(additionalPagePromises);

              // Combine all pages
              for (const pageReactions of additionalPagesResults) {
                allReactionsForPost.push(...pageReactions);
              }

              console.log(`⚡ REACTIONS v17 - Post ${postUrl} completed: ${allReactionsForPost.length} total reactions from ${maxPages} pages`);
            }
          }

          return allReactionsForPost;

        } catch (error) {
          console.error(`⚡ REACTIONS v17 - Error processing post ${postUrl}:`, error);
          return []; // Return empty array for failed posts
        }
      });

      // Wait for current batch to complete
      const batchResults = await Promise.all(batchPromises);

      // Flatten and add to all reactions
      for (const postReactions of batchResults) {
        allReactions.push(...postReactions);
      }

      console.log(`⚡ REACTIONS v17 - Batch completed. Total reactions so far: ${allReactions.length}`);
    }

    console.log(`⚡ REACTIONS v17 - All posts completed. Final total: ${allReactions.length} reactions`);
    return allReactions;
  }
}

// Helper function to extract profile identifiers
function extractProfileIdentifiers(profileUrl: string) {
  if (!profileUrl) return {
    primary: null,
    secondary: null,
    public: null
  };

  // Handle direct ACoA IDs (e.g., "ACoAAABnKnEBKbETIZ1QuWpRI9xia7Jl92rsM9w")
  if (profileUrl.startsWith('ACoA')) {
    return {
      primary: profileUrl,
      secondary: null,
      public: null
    };
  }

  // Extract from LinkedIn URLs
  const urlMatch = profileUrl.match(/\/in\/([^/?]+)/);
  if (!urlMatch) return {
    primary: null,
    secondary: null,
    public: null
  };

  const identifier = urlMatch[1];

  // Check if it's an ACoA ID or vanity URL
  if (identifier.startsWith('ACoA')) {
    return {
      primary: identifier,
      secondary: null,
      public: null
    };
  } else {
    return {
      primary: null,
      secondary: identifier,
      public: identifier
    };
  }
}

// Helper function to normalize URN for consistent storage
function normalizeUrn(urn: string) {
  if (!urn) return urn;
  
  // If it's a full URN like "urn:li:person:ACoAAABnKnE...", extract just the ID part
  if (urn.startsWith('urn:li:person:')) {
    return urn.replace('urn:li:person:', '');
  }
  
  return urn;
}

// Enhanced profile upserting with dual identifiers and comprehensive matching
async function upsertProfilesWithDualIdentifiers(supabase: any, userId: string, reactionsData: any[]) {
  console.log(`⚡ REACTIONS v17 - Upserting profiles for ${reactionsData.length} reactions`);
  
  const newlyUpsertedIds: string[] = [];
  const allProcessedIds: string[] = [];

  // Extract unique profiles from reactions
  const uniqueProfiles = new Map();
  reactionsData.forEach(reaction => {
    if (reaction.reactor?.profile_url) {
      uniqueProfiles.set(reaction.reactor.profile_url, reaction.reactor);
    }
  });

  console.log(`⚡ REACTIONS v17 - Found ${uniqueProfiles.size} unique profiles to process`);

  for (const [profileUrl, reactor] of uniqueProfiles) {
    try {
      const identifiers = extractProfileIdentifiers(profileUrl);
      const preservedUrn = normalizeUrn(profileUrl); // Keep original for legacy compatibility

      console.log(`⚡ REACTIONS v17 - Processing profile: ${reactor.name} with identifiers:`, identifiers);

      // Use the comprehensive matching function from the database
      const { data: existingProfileId } = await supabase.rpc('find_existing_profile_by_identifiers', {
        p_urn: preservedUrn || '',
        p_primary_identifier: identifiers.primary || '',
        p_secondary_identifier: identifiers.secondary || '',
        p_public_identifier: identifiers.public || '',
        p_profile_url: profileUrl || ''
      });

      if (existingProfileId) {
        // Update existing profile
        await supabase.from('profiles').update({
          name: reactor.name || null,
          headline: reactor.headline || null,
          profile_url: profileUrl,
          profile_picture_url: reactor.profile_pictures?.large || reactor.profile_pictures?.medium || reactor.profile_pictures?.small || null,
          last_updated: new Date().toISOString(),
          // Ensure identifiers are populated if missing
          primary_identifier: identifiers.primary || null,
          secondary_identifier: identifiers.secondary || null,
          public_identifier: identifiers.public || null,
          urn: preservedUrn
        }).eq('id', existingProfileId);

        allProcessedIds.push(existingProfileId);
        console.log(`⚡ REACTIONS v17 - Updated existing profile: ${existingProfileId}`);

      } else {
        // Create new profile
        const { data: newProfile, error } = await supabase.from('profiles').insert({
          urn: preservedUrn,
          name: reactor.name || null,
          headline: reactor.headline || null,
          profile_url: profileUrl,
          profile_picture_url: reactor.profile_pictures?.large || reactor.profile_pictures?.medium || reactor.profile_pictures?.small || null,
          first_seen: new Date().toISOString(),
          last_updated: new Date().toISOString(),
          primary_identifier: identifiers.primary || null,
          secondary_identifier: identifiers.secondary || null,
          public_identifier: identifiers.public || null
        }).select('id').single();

        if (error) {
          console.error(`⚡ REACTIONS v17 - Error creating profile for ${reactor.name}:`, error);
          continue;
        }

        newlyUpsertedIds.push(newProfile.id);
        allProcessedIds.push(newProfile.id);
        console.log(`⚡ REACTIONS v17 - Created new profile: ${newProfile.id} for ${reactor.name}`);
      }

    } catch (error) {
      console.error(`⚡ REACTIONS v17 - Error processing profile ${reactor.name}:`, error);
    }
  }

  console.log(`⚡ REACTIONS v17 - Profile upsert complete: ${newlyUpsertedIds.length} new, ${allProcessedIds.length} total`);
  return {
    newlyUpsertedIds,
    allProcessedIds
  };
}

Deno.serve(async (req) => {
  console.log('⚡ REACTIONS v17 - FIXED: Now updates last_reactions_scrape timestamp!');
  
  try {
    // Handle CORS preflight requests
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
          'Access-Control-Allow-Methods': 'POST, OPTIONS'
        }
      });
    }

    // Parse request with better error handling
    let requestBody: any;
    try {
      const requestText = await req.text();
      console.log('⚡ REACTIONS v17 - Raw request body:', requestText);
      
      if (!requestText || requestText.trim() === '') {
        throw new Error('Request body is empty');
      }
      
      requestBody = JSON.parse(requestText);
    } catch (parseError) {
      console.error('⚡ REACTIONS v17 - JSON parse error:', parseError);
      return new Response(JSON.stringify({
        error: 'Invalid JSON in request body',
        details: parseError.message
      }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    const { postIds } = requestBody;

    if (!postIds || !Array.isArray(postIds) || postIds.length === 0) {
      return new Response(JSON.stringify({
        error: 'Post IDs array is required'
      }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    console.log(`⚡ REACTIONS v17 - Processing ${postIds.length} posts:`, postIds);

    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get user from JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({
        error: 'Authorization header required'
      }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      console.error('⚡ REACTIONS v17 - Auth error:', authError);
      return new Response(JSON.stringify({
        error: 'Authentication failed'
      }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    console.log(`⚡ REACTIONS v17 - Authenticated user: ${user.id}`);

    // Get user's Apify API key
    const { data: userSettings, error: settingsError } = await supabase
      .from('user_settings')
      .select('apify_api_key')
      .eq('user_id', user.id)
      .single();

    if (settingsError || !userSettings?.apify_api_key) {
      console.error('⚡ REACTIONS v17 - Settings error:', settingsError);
      return new Response(JSON.stringify({
        error: 'Apify API key not configured'
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // Get posts to scrape
    const { data: posts, error: postsError } = await supabase
      .from('posts')
      .select('*')
      .in('id', postIds)
      .eq('user_id', user.id);

    if (postsError || !posts || posts.length === 0) {
      console.error('⚡ REACTIONS v17 - Posts error:', postsError);
      return new Response(JSON.stringify({
        error: 'No valid posts found'
      }), {
        status: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    console.log(`⚡ REACTIONS v17 - Found ${posts.length} posts to scrape`);

    // Initialize Apify service and scrape reactions with smart pagination
    const apifyService = new ApifyService(userSettings.apify_api_key);
    const postUrls = posts.map(p => p.post_url);

    console.log(`⚡ REACTIONS v17 - Starting smart concurrent scraping for posts:`, postUrls);
    const allReactionsData = await apifyService.scrapeAllPostReactionsConcurrent(postUrls);
    console.log(`⚡ REACTIONS v17 - Scraping completed. Got ${allReactionsData.length} total reactions`);

    // Upsert profiles with comprehensive matching
    const { newlyUpsertedIds, allProcessedIds } = await upsertProfilesWithDualIdentifiers(supabase, user.id, allReactionsData);

    // Process and save reactions
    let totalReactions = 0;
    let totalNewReactions = 0;
    let totalProcessed = 0;

    // Create comprehensive URN mapping for all processed profiles
    const { data: fullProfiles } = await supabase
      .from('profiles')
      .select('id, urn, primary_identifier, secondary_identifier, public_identifier, alternative_urns')
      .in('id', allProcessedIds);

    const urnToIdMap = new Map();
    fullProfiles?.forEach(profile => {
      // Map ALL possible identifier formats to the same profile ID
      if (profile.urn) urnToIdMap.set(profile.urn, profile.id);
      if (profile.primary_identifier) urnToIdMap.set(profile.primary_identifier, profile.id);
      if (profile.secondary_identifier) urnToIdMap.set(profile.secondary_identifier, profile.id);
      if (profile.public_identifier) urnToIdMap.set(profile.public_identifier, profile.id);
      
      if (profile.alternative_urns && Array.isArray(profile.alternative_urns)) {
        profile.alternative_urns.forEach(altUrn => {
          if (altUrn && typeof altUrn === 'string') {
            urnToIdMap.set(altUrn, profile.id);
          }
        });
      }
    });

    console.log(`⚡ REACTIONS v17 - Created URN mapping for ${urnToIdMap.size} identifiers`);

    for (const post of posts) {
      try {
        const postReactionsData = allReactionsData.filter(reaction => 
          reaction.post_input === post.post_url || 
          reaction._metadata?.post_url === post.post_url
        );

        console.log(`⚡ REACTIONS v17 - Processing ${postReactionsData.length} reactions for post ${post.id}`);

        if (postReactionsData.length === 0) {
          console.log(`⚡ REACTIONS v17 - No reactions found for post ${post.id}`);
          
          // 🔧 FIXED: Still update timestamp even if no reactions found
          const { error: updateError } = await supabase.from('posts').update({
            last_reactions_scrape: new Date().toISOString(),
            engagement_needs_scraping: false,
            engagement_last_updated_at: new Date().toISOString()
          }).eq('id', post.id);

          if (updateError) {
            console.error(`⚡ REACTIONS v17 - Error updating post ${post.id}:`, updateError);
          } else {
            console.log(`⚡ REACTIONS v17 - Updated timestamp for post ${post.id} (no reactions)`);
          }

          totalProcessed++;
          continue;
        }

        // Prepare reactions for insertion with profile ID lookup
        const reactions = [];
        for (const reaction of postReactionsData) {
          // Multi-strategy profile ID lookup
          let profileId = null;
          const profileUrl = reaction.reactor.profile_url;

          // Strategy 1: Direct URL lookup
          profileId = urnToIdMap.get(profileUrl);

          // Strategy 2: Extract and try different identifier formats
          if (!profileId) {
            const identifiers = extractProfileIdentifiers(profileUrl);
            if (identifiers.primary) profileId = urnToIdMap.get(identifiers.primary);
            if (!profileId && identifiers.secondary) profileId = urnToIdMap.get(identifiers.secondary);
            if (!profileId && identifiers.public) profileId = urnToIdMap.get(identifiers.public);
          }

          // Strategy 3: Try normalized URN
          if (!profileId) {
            const normalizedUrn = normalizeUrn(profileUrl);
            profileId = urnToIdMap.get(normalizedUrn);
          }

          if (!profileId) {
            console.error(`⚡ REACTIONS v17 - Profile ID not found for URN: ${profileUrl}`);
            continue;
          }

          reactions.push({
            user_id: user.id,
            post_id: post.id,
            reactor_profile_id: profileId,
            reaction_type: reaction.reaction_type,
            scraped_at: new Date().toISOString(),
            page_number: reaction._metadata?.page_number || 1
          });
        }

        console.log(`⚡ REACTIONS v17 - Prepared ${reactions.length} reactions for insertion`);

        if (reactions.length > 0) {
          // Delete existing reactions for this post
          const { error: deleteError } = await supabase
            .from('reactions')
            .delete()
            .eq('user_id', user.id)
            .eq('post_id', post.id);

          if (deleteError) {
            console.error(`⚡ REACTIONS v17 - Error deleting existing reactions:`, deleteError);
          }

          // Insert new reactions
          const { data: insertedReactions, error: insertError } = await supabase
            .from('reactions')
            .insert(reactions)
            .select('id');

          if (insertError) {
            console.error(`⚡ REACTIONS v17 - Error inserting reactions:`, insertError);
          } else {
            const newReactionsCount = insertedReactions?.length || 0;
            totalReactions += reactions.length;
            totalNewReactions += newReactionsCount;
            console.log(`⚡ REACTIONS v17 - Inserted ${newReactionsCount} reactions for post ${post.id}`);
          }
        }

        // 🔧 FIXED: Update post metadata with timestamp (same as comments function)
        const { error: updateError } = await supabase.from('posts').update({
          last_reactions_scrape: new Date().toISOString(),
          engagement_needs_scraping: false,
          engagement_last_updated_at: new Date().toISOString()
        }).eq('id', post.id);

        if (updateError) {
          console.error(`⚡ REACTIONS v17 - Error updating post ${post.id}:`, updateError);
        } else {
          console.log(`⚡ REACTIONS v17 - Updated timestamp for post ${post.id}`);
        }

        totalProcessed++;

      } catch (error) {
        console.error(`⚡ REACTIONS v17 - Error processing post ${post.id}:`, error);
        totalProcessed++;
      }
    }

    // Update last_sync_time to mark this as a completed scraping session
    try {
      await supabase.from('user_settings').update({
        last_sync_time: new Date().toISOString()
      }).eq('user_id', user.id);
      console.log('⚡ REACTIONS v17 - Updated last_sync_time for accurate "New Profiles" tracking');
    } catch (syncError) {
      console.warn('⚡ REACTIONS v17 - Failed to update last_sync_time:', syncError);
    }

    const response = {
      success: true,
      message: `Reactions scraping completed with smart concurrent pagination!`,
      totalPosts: posts.length,
      processedPosts: totalProcessed,
      totalReactions,
      newReactions: totalNewReactions,
      // Return profile information for separate enrichment
      profiles: {
        newProfilesFound: newlyUpsertedIds.length,
        totalProfilesProcessed: allProcessedIds.length,
        profileIds: allProcessedIds // Frontend can use this to trigger enrichment
      }
    };

    console.log('⚡ REACTIONS v17 - Final response:', response);

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
      }
    });

  } catch (error) {
    console.error('⚡ REACTIONS v17 - Unexpected error:', error);
    return new Response(JSON.stringify({
      error: 'Internal server error',
      details: error.message
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
      }
    });
  }
});
