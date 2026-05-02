/**
 * send-otp/index.ts
 *
 * Generates a 6-digit OTP for the owner login, stores it in the
 * organizations table (with a 10-minute expiry), and "sends" it.
 *
 * Current delivery mode: STUB — OTP is returned in the response body
 * as `test_otp` so you can test without email.  When Resend is wired up,
 * delete the `test_otp` line and uncomment the Resend block.
 *
 * Required secrets (set via `supabase secrets set`):
 *   SUPABASE_URL              auto-set
 *   SUPABASE_SERVICE_ROLE_KEY auto-set
 *   RESEND_API_KEY            (add later when wiring email)
 *   OTP_FROM_EMAIL            e.g. noreply@yourdomain.com  (add later)
 *
 * Invoke from client:
 *   supabase.functions.invoke('send-otp', { body: { orgId } })
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// const RESEND_API_KEY         = Deno.env.get('RESEND_API_KEY');   // ← uncomment when ready
// const OTP_FROM_EMAIL         = Deno.env.get('OTP_FROM_EMAIL');   // ← uncomment when ready

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CORS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

    try {
        const { orgId } = await req.json();
        if (!orgId) throw new Error('orgId required');

        // 1. Fetch org — get otp_enabled + otp_email
        const { data: org, error: fetchErr } = await supabase
            .from('organizations')
            .select('id, otp_enabled, otp_email')
            .eq('id', orgId)
            .single();

        if (fetchErr || !org) throw new Error('Org not found');
        if (!org.otp_enabled)  throw new Error('OTP is not enabled for this org');

        // 2. Generate OTP
        const otp    = String(Math.floor(100000 + Math.random() * 900000));
        const expiry = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min

        // 3. Store OTP + expiry
        const { error: updateErr } = await supabase
            .from('organizations')
            .update({ otp_code: otp, otp_expires_at: expiry })
            .eq('id', orgId);

        if (updateErr) throw updateErr;

        // 4. Send via email
        // ── STUB: log to console, return test_otp for testing ──────────────
        console.log(`[send-otp] org=${orgId} code=${otp} expires=${expiry}`);
        const testOtp = otp; // ← REMOVE this line when Resend is wired

        // ── RESEND (uncomment when ready) ──────────────────────────────────
        // const sendResp = await fetch('https://api.resend.com/emails', {
        //     method: 'POST',
        //     headers: {
        //         'Content-Type': 'application/json',
        //         'Authorization': `Bearer ${RESEND_API_KEY}`,
        //     },
        //     body: JSON.stringify({
        //         from:    OTP_FROM_EMAIL,
        //         to:      org.otp_email,
        //         subject: 'JJ Ledger — Your Login Code',
        //         html: `
        //             <div style="font-family:sans-serif;max-width:400px;margin:auto;padding:24px;">
        //                 <h2 style="color:#1e293b;">JJ Ledger Login Code</h2>
        //                 <p style="color:#475569;">Your one-time passcode is:</p>
        //                 <div style="font-size:36px;font-weight:800;letter-spacing:8px;color:#3b82f6;
        //                             padding:16px;background:#f0f9ff;border-radius:8px;
        //                             text-align:center;margin:16px 0;">${otp}</div>
        //                 <p style="color:#94a3b8;font-size:13px;">
        //                     This code expires in 10 minutes.<br>
        //                     If you didn't request this, ignore this email.
        //                 </p>
        //             </div>`,
        //     }),
        // });
        // if (!sendResp.ok) throw new Error('Email send failed');
        // const testOtp = undefined; // ← keep undefined in production

        return new Response(
            JSON.stringify({ ok: true, test_otp: testOtp }),
            { headers: { ...CORS, 'Content-Type': 'application/json' } },
        );

    } catch (err: any) {
        console.error('[send-otp] error:', err.message);
        return new Response(
            JSON.stringify({ ok: false, error: err.message }),
            { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } },
        );
    }
});
