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

    const cleanEmail = email.toLowerCase().trim()

    // ── Admin client ────────────────────────────────────────────────────────
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

    // ── Fetch production name (using the specific productionId from the request) ──
    const { data: production, error: prodError } = await adminClient
      .from('production')
      .select('name')
      .eq('id', productionId)
      .single()

    if (prodError || !production) {
      return new Response(JSON.stringify({ error: 'Production not found.' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const productionName = production.name
    const roleLabel = role.charAt(0).toUpperCase() + role.slice(1)

    // ── Store invite row ────────────────────────────────────────────────────
    const token = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

    // Remove any existing pending invite for this email + production
    await adminClient
      .from('invites')
      .delete()
      .eq('email', cleanEmail)
      .eq('production_id', productionId)
      .eq('accepted', false)

    const { error: insertError } = await adminClient
      .from('invites')
      .insert({
        email:         cleanEmail,
        production_id: productionId,
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

    // ── Build redirect URL containing our invite token ──────────────────────
    const appUrl = Deno.env.get('APP_URL') ?? 'https://footballmanager.xyz'
    const redirectTo = `${appUrl}?invite=${token}`

    // ── Send invite email via Supabase Auth (uses your email template) ──────
    // We pass production_name and role_label explicitly so the template
    // {{ .Data.production_name }} and {{ .Data.role_label }} always resolve
    // to the correct values for THIS specific production.
    const { error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(
      cleanEmail,
      {
        redirectTo,
        data: {
          production_id:   productionId,
          production_name: productionName,   // ← correct name for THIS production
          role_label:      roleLabel,        // ← e.g. "Member", "Admin"
        },
      }
    )

    if (inviteError) {
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
