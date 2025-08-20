import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

interface WebhookPushRequest {
  webhookId: string;
  profileIds: string[];
}

// POST - Push selected profiles to a specific webhook
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  
  try {
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { webhookId, profileIds }: WebhookPushRequest = await request.json();

    // Validate input
    if (!webhookId) {
      return NextResponse.json({ error: 'Webhook ID is required' }, { status: 400 });
    }

    if (!profileIds || !Array.isArray(profileIds) || profileIds.length === 0) {
      return NextResponse.json({ error: 'Profile IDs array is required' }, { status: 400 });
    }

    console.log(`Starting webhook push for ${profileIds.length} profiles to webhook ${webhookId}`);

    // Get webhook details
    const { data: webhook, error: webhookError } = await supabase
      .from('webhooks')
      .select('*')
      .eq('id', webhookId)
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single();

    if (webhookError || !webhook) {
      console.error('Webhook not found or not active:', webhookError);
      return NextResponse.json({ error: 'Webhook not found or not active' }, { status: 404 });
    }

    // Get profiles data (only database fields, computed fields will be calculated)
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select(`
        id, urn, name, headline, profile_url, profile_picture_url,
        first_name, last_name, country, city, current_title, current_company,
        company_linkedin_url, first_seen, last_updated, last_enriched_at,
        public_identifier, primary_identifier, secondary_identifier
      `)
      .in('id', profileIds);

    if (profilesError) {
      console.error('Error fetching profiles:', profilesError);
      return NextResponse.json({ error: 'Failed to fetch profiles' }, { status: 500 });
    }

    if (!profiles || profiles.length === 0) {
      return NextResponse.json({ error: 'No profiles found' }, { status: 404 });
    }

    // Get reactions and comments data to compute latest engagement type
    const { data: { user: currentUser }, error: authCheckError } = await supabase.auth.getUser();
    if (authCheckError || !currentUser) {
      return NextResponse.json({ error: 'Authentication error' }, { status: 401 });
    }

    // Get reactions data for these profiles
    const { data: reactionsData, error: reactionsError } = await supabase
      .from('posts')
      .select(`
        id,
        post_id,
        post_url,
        posted_at_iso,
        reactions!inner(
          reaction_type,
          scraped_at,
          reactor_profile_id,
          profiles!inner(id)
        )
      `)
      .eq('user_id', currentUser.id)
      .in('reactions.reactor_profile_id', profileIds);

    // Get comments data for these profiles  
    const { data: commentsData, error: commentsError } = await supabase
      .from('posts')
      .select(`
        id,
        post_id,
        post_url,
        posted_at_iso,
        comments!inner(
          comment_text,
          posted_at_date,
          commenter_profile_id,
          profiles!inner(id)
        )
      `)
      .eq('user_id', currentUser.id)
      .in('comments.commenter_profile_id', profileIds);

    if (reactionsError) {
      console.error('Reactions query error:', reactionsError);
    }
    if (commentsError) {
      console.error('Comments query error:', commentsError);
    }

    console.log('Webhook reactions data:', reactionsData?.length, 'reactions found');
    console.log('Webhook comments data:', commentsData?.length, 'comments found');

    // Process engagement data to compute latest engagement type for each profile
    const reactionsByProfile = new Map<string, any[]>();
    reactionsData?.forEach(post => {
      post.reactions?.forEach(reaction => {
        const profileId = reaction.profiles?.id;
        if (!profileId) return;
        
        if (!reactionsByProfile.has(profileId)) {
          reactionsByProfile.set(profileId, []);
        }
        reactionsByProfile.get(profileId)!.push({
          ...reaction,
          post: {
            id: post.id,
            post_id: post.post_id,
            post_url: post.post_url,
            posted_at_iso: post.posted_at_iso
          }
        });
      });
    });
    
    const commentsByProfile = new Map<string, any[]>();
    commentsData?.forEach(post => {
      post.comments?.forEach(comment => {
        const profileId = comment.profiles?.id;
        if (!profileId) return;
        
        if (!commentsByProfile.has(profileId)) {
          commentsByProfile.set(profileId, []);
        }
        commentsByProfile.get(profileId)!.push({
          ...comment,
          post: {
            id: post.id,
            post_id: post.post_id,
            post_url: post.post_url,
            posted_at_iso: post.posted_at_iso
          }
        });
      });
    });

    // Compute all missing fields for each profile (same logic as frontend)
    const profileEngagementTypes = new Map<string, string>();
    const profileStats = new Map<string, any>();
    
    profiles.forEach(profile => {
      let latestEngagementType = '';
      
      // Find all posts this profile engaged with
      const profileReactions = reactionsByProfile.get(profile.id) || [];
      const profileComments = commentsByProfile.get(profile.id) || [];
      
      // Combine all posts and find the most recent one
      const allEngagedPosts = new Map<string, any>();
      
      profileReactions.forEach(reaction => {
        const postId = reaction.post.id; // Use post.id not post.post_id
        if (!allEngagedPosts.has(postId)) {
          allEngagedPosts.set(postId, {
            post_id: reaction.post.post_id,
            post_url: reaction.post.post_url,
            posted_at_iso: reaction.post.posted_at_iso,
            engagement_types: []
          });
        }
        allEngagedPosts.get(postId)!.engagement_types.push('reaction');
      });
      
      profileComments.forEach(comment => {
        const postId = comment.post.id; // Use post.id not post.post_id
        if (!allEngagedPosts.has(postId)) {
          allEngagedPosts.set(postId, {
            post_id: comment.post.post_id,
            post_url: comment.post.post_url,
            posted_at_iso: comment.post.posted_at_iso,
            engagement_types: []
          });
        }
        allEngagedPosts.get(postId)!.engagement_types.push('comment');
      });
      
      // Calculate counts
      const uniquePosts = Array.from(allEngagedPosts.values());
      const totalReactions = uniquePosts.filter(post => post.engagement_types.includes('reaction')).length;
      const totalComments = uniquePosts.filter(post => post.engagement_types.includes('comment')).length;
      const postsEngagedWith = uniquePosts.length;
      
      // Find the most recent post
      const latestPost = uniquePosts.reduce((latest, post) => {
        const postDate = post.posted_at_iso ? new Date(post.posted_at_iso) : new Date(0);
        const latestDate = latest ? new Date(latest.posted_at_iso || 0) : new Date(0);
        return postDate > latestDate ? post : latest;
      }, null as any);
      
      // Get latest post info
      const latestPostDate = latestPost?.posted_at_iso || null;
      const latestPostUrl = latestPost?.post_url || null;
      
      if (latestPost) {
        // If they commented on the latest post, prefer Comment
        if (latestPost.engagement_types.includes('comment')) {
          latestEngagementType = 'Comment';
        } else if (latestPost.engagement_types.includes('reaction')) {
          latestEngagementType = 'Like';
        }
      }
      
      profileEngagementTypes.set(profile.id, latestEngagementType);
      profileStats.set(profile.id, {
        total_reactions: totalReactions,
        total_comments: totalComments,
        posts_engaged_with: postsEngagedWith,
        latest_post_date: latestPostDate,
        latest_post_url: latestPostUrl
      });
    });

    console.log(`Found ${profiles.length} profiles to push to webhook: ${webhook.name}`);

    // Push profiles one by one to the webhook
    const results = {
      success: 0,
      failed: 0,
      errors: [] as string[]
    };

    for (const profile of profiles) {
      try {
        console.log(`Pushing profile: ${profile.name} (${profile.id}) to ${webhook.url}`);

        // Format dates consistently with CSV/clipboard exports
        const formatDateISO = (dateString: string | null): string => {
          if (!dateString) return ''
          try {
            const date = new Date(dateString)
            return date.toISOString().replace('T', ' ').replace('Z', '+00')
          } catch {
            return ''
          }
        }

        // Get computed stats for this profile
        const stats = profileStats.get(profile.id) || {
          total_reactions: 0,
          total_comments: 0,
          posts_engaged_with: 0,
          latest_post_date: null,
          latest_post_url: null
        };

        // Create profile data matching CSV/clipboard format exactly
        const profileData = {
          'Name': profile.first_name && profile.last_name 
            ? `${profile.first_name} ${profile.last_name}`
            : profile.name || '',
          'First Name': profile.first_name || '',
          'Last Name': profile.last_name || '',
          'URN': profile.urn || '',
          'Profile URL': profile.profile_url || '',
          'Profile Picture URL': profile.profile_picture_url || '',
          'Country': profile.country || '',
          'City': profile.city || '',
          'Headline': profile.headline || '',
          'Current Title': profile.current_title || '',
          'Current Company': profile.current_company || '',
          'Company LinkedIn URL': profile.company_linkedin_url || '',
          'Last Engaged Post Date': formatDateISO(stats.latest_post_date),
          'Last Engaged Post URL': stats.latest_post_url || '',
          'Reaction Type': profileEngagementTypes.get(profile.id) || '',
          'Total Reactions': stats.total_reactions,
          'Total Comments': stats.total_comments,
          'Posts Engaged With': stats.posts_engaged_with,
          'First Seen': formatDateISO(profile.first_seen),
          'Last Updated': formatDateISO(profile.last_updated),
          'Last Enriched': formatDateISO(profile.last_enriched_at)
        }

        const response = await fetch(webhook.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'SocialSignals-Webhook/1.0',
            'X-Webhook-Source': 'SocialSignals',
            'X-Profile-Count': profiles.length.toString(),
          },
          body: JSON.stringify({
            profile: profileData,
            metadata: {
              webhook_name: webhook.name,
              pushed_at: new Date().toISOString(),
              source: 'SocialSignals'
            }
          }),
          // Set a reasonable timeout
          signal: AbortSignal.timeout(10000) // 10 seconds timeout
        });

        if (response.ok) {
          console.log(`✅ Successfully pushed profile ${profile.name} to ${webhook.name}`);
          results.success++;
        } else {
          const errorText = await response.text().catch(() => 'Unknown error');
          const errorMsg = `HTTP ${response.status}: ${errorText}`;
          console.error(`❌ Failed to push profile ${profile.name}: ${errorMsg}`);
          results.failed++;
          results.errors.push(`${profile.name}: ${errorMsg}`);
        }

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error(`❌ Error pushing profile ${profile.name}:`, errorMsg);
        results.failed++;
        results.errors.push(`${profile.name}: ${errorMsg}`);
      }

      // Add a small delay between requests to be respectful to the webhook endpoint
      if (profiles.length > 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log(`Webhook push completed. Success: ${results.success}, Failed: ${results.failed}`);

    // Return results
    return NextResponse.json({
      success: true,
      webhook_name: webhook.name,
      total_profiles: profiles.length,
      pushed_successfully: results.success,
      failed_pushes: results.failed,
      errors: results.errors.length > 0 ? results.errors : undefined
    });

  } catch (error) {
    console.error('Error in webhook push:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: String(error) },
      { status: 500 }
    );
  }
}
