import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // ── Verify the caller is authenticated ─────────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? ''
    const callerClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user }, error: authError } = await callerClient.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Parse request body ──────────────────────────────────────────────────
    const { email, productionId, role = 'member' } = await req.json()

    if (!email || !productionId) {
      return new Response(JSON.stringify({ error: 'Missing required fields: email, productionId' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Admin client (bypasses RLS for invite insert + auth.admin calls) ───
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // ── Verify caller is owner/admin of the specified production ───────────
    const { data: membership, error: memberError } = await adminClient
      .from('production_members')
      .select('role')
      .eq('production_id', productionId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (memberError || !membership || !['owner', 'admin'].includes(membership.role)) {
      return new Response(JSON.stringify({ error: 'You do not have permission to invite to this production.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Fetch production name for the email ────────────────────────────────
    const { data: production } = await adminClient
      .from('production')
      .select('name')
      .eq('id', productionId)
      .maybeSingle()

    const productionName = production?.name || 'the production'

    // ── Generate a unique invite token and insert into invites table ───────
    const token = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days

    const { error: insertError } = await adminClient
      .from('invites')
      .insert({
        email:         email.toLowerCase().trim(),
        production_id: productionId,   // ← rigidly tied to the requested production
        role,
        token,
        expires_at:    expiresAt,
        accepted:      false,
      })

    if (insertError) {
      return new Response(JSON.stringify({ error: `Failed to create invite: ${insertError.message}` }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Build the invite URL with the token ────────────────────────────────
    const appUrl = Deno.env.get('APP_URL') ?? 'https://footballmanager.xyz'
    const inviteUrl = `${appUrl}?invite=${token}`

    // ── Send invite email via auth.admin.inviteUserByEmail ─────────────────
    // This routes through Supabase SMTP (your Resend integration).
    // The redirectTo carries the token so the app can look up the production.
    const { error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(
      email.toLowerCase().trim(),
      {
        redirectTo: inviteUrl,
        data: {
          production_id:   productionId,
          production_name: productionName,
          invite_token:    token,
          role,
        },
      }
    )

    if (inviteError) {
      // Clean up the invite row if the email failed
      await adminClient.from('invites').delete().eq('token', token)
      return new Response(JSON.stringify({ error: inviteError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status:  500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
