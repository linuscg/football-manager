import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const FROM_ADDRESS   = 'Football Manager <noreply@footballmanager.xyz>'

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

    // ── Fetch production name ───────────────────────────────────────────────
    const { data: production } = await adminClient
      .from('production')
      .select('name')
      .eq('id', productionId)
      .maybeSingle()

    const productionName = production?.name || 'the production'

    // ── Generate invite token and store invite row ──────────────────────────
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

    // ── Build the invite URL ────────────────────────────────────────────────
    const appUrl = Deno.env.get('APP_URL') ?? 'https://footballmanager.xyz'
    const inviteUrl = `${appUrl}?invite=${token}`

    // ── Generate a magic link WITHOUT sending an email ─────────────────────
    // generateLink creates the Supabase auth record and returns the link;
    // we then send our own email via Resend so we control the content.
    const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
      type: 'invite',
      email: cleanEmail,
      options: {
        redirectTo: inviteUrl,
      },
    })

    if (linkError || !linkData?.properties?.action_link) {
      // Clean up the invite row
      await adminClient.from('invites').delete().eq('token', token)
      return new Response(JSON.stringify({ error: linkError?.message ?? 'Failed to generate invite link.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const magicLink = linkData.properties.action_link

    // ── Send the email via Resend ───────────────────────────────────────────
    const emailHtml = `
      <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; color: #1e293b;">
        <img src="https://footballmanager.xyz/favicon.svg" alt="Football Manager" width="40" height="40"
          style="margin-bottom: 24px; display: block;" />

        <h2 style="margin: 0 0 8px; font-size: 22px; font-weight: 700;">You've been invited</h2>
        <p style="margin: 0 0 24px; color: #64748b; font-size: 15px;">
          You've been invited to join <strong>${productionName}</strong> on Football Manager
          as <strong>${role.charAt(0).toUpperCase() + role.slice(1)}</strong>.
        </p>

        <a href="${magicLink}"
          style="display: inline-block; background: #4f46e5; color: #fff; text-decoration: none;
                 padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 15px;">
          Accept invitation
        </a>

        <p style="margin: 24px 0 0; font-size: 12px; color: #94a3b8;">
          This link expires in 7 days. If you weren't expecting this invitation, you can ignore this email.
        </p>
      </div>
    `

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from:    FROM_ADDRESS,
        to:      [cleanEmail],
        subject: `You've been invited to ${productionName}`,
        html:    emailHtml,
      }),
    })

    const resendData = await resendRes.json()

    if (!resendRes.ok) {
      // Clean up the invite row
      await adminClient.from('invites').delete().eq('token', token)
      return new Response(JSON.stringify({ error: resendData?.message ?? 'Failed to send email.' }), {
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
