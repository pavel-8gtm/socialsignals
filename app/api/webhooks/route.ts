import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

interface WebhookCreateData {
  name: string;
  url: string;
  description?: string;
  is_active?: boolean;
}

interface WebhookUpdateData {
  name?: string;
  url?: string;
  description?: string;
  is_active?: boolean;
}

// GET - Fetch all webhooks for the current user
export async function GET() {
  const supabase = await createClient();
  
  try {
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch user's webhooks
    const { data: webhooks, error } = await supabase
      .from('webhooks')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching webhooks:', error);
      return NextResponse.json({ error: 'Failed to fetch webhooks' }, { status: 500 });
    }

    return NextResponse.json({ webhooks: webhooks || [] });

  } catch (error) {
    console.error('Error in GET webhooks:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST - Create a new webhook
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  
  try {
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const webhookData: WebhookCreateData = await request.json();

    // Validate required fields
    if (!webhookData.name?.trim()) {
      return NextResponse.json({ error: 'Webhook name is required' }, { status: 400 });
    }

    if (!webhookData.url?.trim()) {
      return NextResponse.json({ error: 'Webhook URL is required' }, { status: 400 });
    }

    // Validate URL format
    try {
      new URL(webhookData.url);
    } catch {
      return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 });
    }

    // Create webhook
    const { data: webhook, error } = await supabase
      .from('webhooks')
      .insert({
        user_id: user.id,
        name: webhookData.name.trim(),
        url: webhookData.url.trim(),
        description: webhookData.description?.trim() || null,
        is_active: webhookData.is_active ?? true,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating webhook:', error);
      if (error.code === '23505') {
        return NextResponse.json({ error: 'Webhook name already exists' }, { status: 409 });
      }
      return NextResponse.json({ error: 'Failed to create webhook' }, { status: 500 });
    }

    return NextResponse.json({ webhook }, { status: 201 });

  } catch (error) {
    console.error('Error in POST webhooks:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// PUT - Update a webhook
export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  
  try {
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id, ...updateData }: { id: string } & WebhookUpdateData = await request.json();

    if (!id) {
      return NextResponse.json({ error: 'Webhook ID is required' }, { status: 400 });
    }

    // Validate URL format if provided
    if (updateData.url) {
      try {
        new URL(updateData.url);
      } catch {
        return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 });
      }
    }

    // Update webhook
    const updateFields: any = {
      updated_at: new Date().toISOString()
    };

    if (updateData.name?.trim()) updateFields.name = updateData.name.trim();
    if (updateData.url?.trim()) updateFields.url = updateData.url.trim();
    if (updateData.description !== undefined) updateFields.description = updateData.description?.trim() || null;
    if (updateData.is_active !== undefined) updateFields.is_active = updateData.is_active;

    const { data: webhook, error } = await supabase
      .from('webhooks')
      .update(updateFields)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single();

    if (error) {
      console.error('Error updating webhook:', error);
      if (error.code === '23505') {
        return NextResponse.json({ error: 'Webhook name already exists' }, { status: 409 });
      }
      return NextResponse.json({ error: 'Failed to update webhook' }, { status: 500 });
    }

    if (!webhook) {
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });
    }

    return NextResponse.json({ webhook });

  } catch (error) {
    console.error('Error in PUT webhooks:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE - Delete a webhook
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  
  try {
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await request.json();

    if (!id) {
      return NextResponse.json({ error: 'Webhook ID is required' }, { status: 400 });
    }

    // Delete webhook
    const { error } = await supabase
      .from('webhooks')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);

    if (error) {
      console.error('Error deleting webhook:', error);
      return NextResponse.json({ error: 'Failed to delete webhook' }, { status: 500 });
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Error in DELETE webhooks:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
