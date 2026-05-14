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

    // ── Generate magic link WITHOUT sending an email ────────────────────────
    // inviteUserByEmail() reuses existing auth user metadata when the email
    // already exists, so the wrong production name can bleed through.
    // generateLink() gives us the magic link so we send our own email via
    // Resend with the production name baked directly into the HTML.
    const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
      type: 'invite',
      email: cleanEmail,
      options: { redirectTo },
    })

    if (linkError || !linkData?.properties?.action_link) {
      await adminClient.from('invites').delete().eq('token', token)
      return new Response(JSON.stringify({ error: linkError?.message ?? 'Failed to generate invite link.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const magicLink = linkData.properties.action_link

    // ── Send email via Resend ───────────────────────────────────────────────
    const html = `
      <h2 style="font-family:sans-serif;color:#111827;">You've been invited to Football Manager</h2>

      <p style="font-family:sans-serif;color:#374151;font-size:15px;line-height:1.6;">
        You've been invited to join <strong>${productionName}</strong>
        as <strong>${roleLabel}</strong>. Click below to set up your
        account and get started.
      </p>

      <p style="margin:28px 0;">
        <a href="${magicLink}"
           style="font-family:sans-serif;background:#6366f1;color:#fff;text-decoration:none;
                  padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px;display:inline-block;">
          Accept invitation →
        </a>
      </p>

      <p style="font-family:sans-serif;color:#9ca3af;font-size:12px;line-height:1.6;">
        If you weren't expecting this invite, you can safely ignore this email.<br/>
        This link expires in 7 days.
      </p>

      <hr style="border:none;border-top:1px solid #f3f4f6;margin:24px 0;" />

      <p style="font-family:sans-serif;color:#9ca3af;font-size:11px;">
        Football Manager · Production Management
      </p>
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
        html,
      }),
    })

    if (!resendRes.ok) {
      const resendData = await resendRes.json()
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
