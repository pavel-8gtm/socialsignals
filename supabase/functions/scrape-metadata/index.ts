import "jsr:@supabase/functions-js/edge-runtime.d.ts";

class ApifyService {
  apiKey;
  baseUrl = 'https://api.apify.com/v2';

  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  async scrapePostDetail(postUrl) {
    console.log(`🚀 Scraping post detail for: ${postUrl}`);
    const actorId = 'apimaestro~linkedin-post-detail';
    console.log(`🎯 Using actor: ${actorId}`);

    const runInput = {
      post_url: postUrl
    };

    try {
      const apiUrl = `${this.baseUrl}/acts/${actorId}/runs`;
      console.log(`📡 API URL: ${apiUrl}`);
      console.log(`📝 Input: ${JSON.stringify(runInput)}`);

      const runResponse = await fetch(apiUrl, {
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

      console.log(`📈 Response status: ${runResponse.status}`);

      if (!runResponse.ok) {
        const errorText = await runResponse.text();
        console.error(`❌ Failed to start actor: ${runResponse.status} ${runResponse.statusText}`);
        console.error(`❌ Error details: ${errorText}`);
        throw new Error(`Failed to start actor for ${postUrl}: ${errorText}`);
      }

      const runData = await runResponse.json();
      console.log(`📊 Started Apify run: ${runData.data.id}`);

      return await this.pollAndGetResults(runData.data.id, actorId);
    } catch (error) {
      console.error('❌ Apify scraping failed:', error);
      throw error;
    }
  }

  async pollAndGetResults(runId, actorId) {
    let run = { status: 'RUNNING' };
    const maxWaitTime = 30 * 60 * 1000; // 30 minutes
    const startTime = Date.now();

    while (run.status === 'RUNNING' || run.status === 'READY') {
      if (Date.now() - startTime > maxWaitTime) {
        throw new Error('Apify run timeout after 30 minutes');
      }

      await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds

      const statusResponse = await fetch(`${this.baseUrl}/acts/${actorId}/runs/${runId}`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });

      if (!statusResponse.ok) {
        throw new Error(`Failed to get run status: ${statusResponse.statusText}`);
      }

      const statusData = await statusResponse.json();
      run = statusData.data;
      console.log(`📈 Run ${runId} status: ${run.status}`);
    }

    if (run.status !== 'SUCCEEDED') {
      throw new Error(`Actor run failed with status: ${run.status}`);
    }

    const datasetId = run.defaultDatasetId;
    console.log(`📁 Using dataset ID: ${datasetId}`);

    const datasetResponse = await fetch(`${this.baseUrl}/datasets/${datasetId}/items`, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`
      }
    });

    if (!datasetResponse.ok) {
      throw new Error(`Failed to fetch results: ${datasetResponse.statusText}`);
    }

    const results = await datasetResponse.json();
    if (!results || results.length === 0) {
      throw new Error('No results returned from Apify');
    }

    console.log(`✅ Retrieved post detail from Apify (${results.length} items)`);
    return results[0];
  }
}

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
      }
    });
  }

  try {
    console.log('🎯 scrape-metadata Edge Function called (v8 with FIXED nested data mapping)');

    // Get Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const { createClient } = await import('npm:@supabase/supabase-js@2');
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get user from auth header
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({
        error: 'Missing authorization header'
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(JSON.stringify({
        error: 'Unauthorized'
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Parse request body
    const { postIds } = await req.json();
    if (!postIds || !Array.isArray(postIds) || postIds.length === 0) {
      return new Response(JSON.stringify({
        error: 'Post IDs are required'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log(`🎯 Starting metadata scraping for ${postIds.length} posts for user ${user.id}`);

    // Get posts data
    const { data: posts, error: postsError } = await supabase
      .from('posts')
      .select('id, post_url, num_likes, num_comments, num_shares')
      .in('id', postIds)
      .eq('user_id', user.id);

    if (postsError || !posts) {
      return new Response(JSON.stringify({
        error: 'Failed to fetch posts'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get Apify API key from user settings
    const { data: settings, error: settingsError } = await supabase
      .from('user_settings')
      .select('apify_api_key')
      .eq('user_id', user.id)
      .single();

    if (settingsError || !settings?.apify_api_key) {
      return new Response(JSON.stringify({
        error: 'Apify API key not found in settings'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Initialize Apify service
    const apifyService = new ApifyService(settings.apify_api_key);

    let totalProcessed = 0;
    let totalUpdated = 0;
    const results = [];
    const errors = [];

    // Process posts in batches to respect Apify concurrent runs limit
    const batchSize = 30;
    for (let i = 0; i < posts.length; i += batchSize) {
      const batch = posts.slice(i, i + batchSize);
      console.log(`📦 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(posts.length / batchSize)} (${batch.length} posts)`);

      // Process batch concurrently for better performance
      const batchPromises = batch.map(async (post) => {
        try {
          console.log(`🔄 Fetching metadata for post ${post.id}: ${post.post_url}`);
          const responseData = await apifyService.scrapePostDetail(post.post_url);
          
          console.log(`📊 METADATA v8 - Raw response structure:`, JSON.stringify(responseData, null, 2));

          // FIXED: Handle nested post structure from apimaestro~linkedin-post-detail actor
          const postData = responseData.post || responseData;
          const authorData = responseData.author || postData.author;
          const statsData = responseData.stats || postData.stats;

          console.log(`📊 METADATA v8 - Extracted postData:`, JSON.stringify(postData, null, 2));
          console.log(`📊 METADATA v8 - Extracted authorData:`, JSON.stringify(authorData, null, 2));
          console.log(`📊 METADATA v8 - Extracted statsData:`, JSON.stringify(statsData, null, 2));

          // Get current engagement stats to detect changes
          const current = {
            num_likes: post.num_likes || 0,
            num_comments: post.num_comments || 0,
            num_shares: post.num_shares || 0
          };

          // Extract new stats from the nested structure
          const newStats = {
            num_likes: statsData?.total_reactions || postData.likesCount || 0,
            num_comments: statsData?.comments || postData.commentsCount || 0,
            num_shares: statsData?.shares || postData.sharesCount || 0
          };

          // Check if engagement changed
          const engagementChanged = newStats.num_likes !== current.num_likes || 
                                  newStats.num_comments !== current.num_comments || 
                                  newStats.num_shares !== current.num_shares;

          // Prepare update data
          const updateData = {
            num_likes: newStats.num_likes,
            num_comments: newStats.num_comments,
            num_shares: newStats.num_shares,
            metadata_last_updated_at: new Date().toISOString()
          };

          // FIXED: Add metadata from nested structure
          if (postData.text) updateData.post_text = postData.text;
          if (postData.type) updateData.post_type = postData.type;
          if (postData.id) updateData.post_id = postData.id;
          if (postData.urn) updateData.post_urn = postData.urn;

          // FIXED: Handle author data
          if (authorData?.name) updateData.author_name = authorData.name;
          if (authorData?.profile_url) updateData.author_profile_url = authorData.profile_url;
          if (authorData?.profileId) updateData.author_profile_id = authorData.profileId;

          // FIXED: Handle nested timestamp structure
          if (postData.created_at?.timestamp) {
            updateData.posted_at_timestamp = postData.created_at.timestamp;
            updateData.posted_at_iso = new Date(postData.created_at.timestamp).toISOString();
          } else if (postData.publishedAt) {
            updateData.posted_at_timestamp = new Date(postData.publishedAt).getTime();
            updateData.posted_at_iso = new Date(postData.publishedAt).toISOString();
          }

          if (engagementChanged) {
            updateData.engagement_last_updated_at = new Date().toISOString();
            updateData.engagement_needs_scraping = true;
          }

          console.log(`📊 METADATA v8 - Final update data for post ${post.id}:`, JSON.stringify(updateData, null, 2));

          // Update post in database
          const { error: updateError } = await supabase
            .from('posts')
            .update(updateData)
            .eq('id', post.id);

          if (updateError) {
            console.error(`Error updating post ${post.id}:`, updateError);
            return {
              success: false,
              postId: post.id,
              error: `Failed to update post ${post.id}: ${updateError.message}`
            };
          } else {
            console.log(`✅ METADATA v8 - Updated post ${post.id} - Text: ${postData.text ? 'YES' : 'NO'}, Type: ${postData.type || 'NONE'}, Timestamp: ${postData.created_at?.timestamp || 'NONE'}`);
            return {
              success: true,
              postId: post.id,
              postUrl: post.post_url,
              oldStats: current,
              newStats: newStats,
              engagementChanged,
              contentUpdated: {
                text: !!postData.text,
                type: !!postData.type,
                timestamp: !!(postData.created_at?.timestamp || postData.publishedAt)
              }
            };
          }
        } catch (error) {
          console.error(`Error processing post ${post.id}:`, error);
          return {
            success: false,
            postId: post.id,
            error: `Failed to process post ${post.id}: ${error instanceof Error ? error.message : 'Unknown error'}`
          };
        }
      });

      // Wait for all posts in this batch to complete
      const batchResults = await Promise.all(batchPromises);

      // Process results
      for (const result of batchResults) {
        if (result.success) {
          totalProcessed++;
          if (result.engagementChanged) {
            totalUpdated++;
          }
          results.push(result);
        } else {
          errors.push(result.error);
        }
      }

      console.log(`Batch ${Math.floor(i / batchSize) + 1} completed: ${batchResults.filter(r => r.success).length} successes, ${batchResults.filter(r => !r.success).length} errors`);

      // Small delay between batches to be nice to Apify
      if (i + batchSize < posts.length) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    // Update last sync time
    await supabase.from('user_settings').update({
      last_sync_time: new Date().toISOString()
    }).eq('user_id', user.id);

    const response = {
      success: true,
      message: `Successfully processed ${totalProcessed}/${posts.length} posts`,
      totalPosts: posts.length,
      processedPosts: totalProcessed,
      postsWithEngagementChanges: totalUpdated,
      results,
      errors
    };

    console.log(`🎉 METADATA v8 - Scraping completed:`, response);

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (error) {
    console.error('❌ Edge function error:', error);
    return new Response(JSON.stringify({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
});
