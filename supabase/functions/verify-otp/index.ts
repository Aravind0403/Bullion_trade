/**
 * verify-otp/index.ts
 *
 * Verifies the 6-digit OTP entered by the owner.
 * On success: clears otp_code + otp_expires_at from the row.
 * On failure: returns { ok: false, error } without clearing.
 *
 * Invoke from client:
 *   supabase.functions.invoke('verify-otp', { body: { orgId, code } })
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CORS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

    try {
        const { orgId, code } = await req.json();
        if (!orgId || !code) throw new Error('orgId and code required');

        // Fetch stored OTP + expiry
        const { data: org, error: fetchErr } = await supabase
            .from('organizations')
            .select('otp_code, otp_expires_at')
            .eq('id', orgId)
            .single();

        if (fetchErr || !org) throw new Error('Org not found');

        // Check existence
        if (!org.otp_code) {
            return new Response(
                JSON.stringify({ ok: false, error: 'No active OTP. Please request a new code.' }),
                { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } },
            );
        }

        // Check expiry
        if (new Date(org.otp_expires_at) < new Date()) {
            // Clear the expired OTP
            await supabase
                .from('organizations')
                .update({ otp_code: null, otp_expires_at: null })
                .eq('id', orgId);

            return new Response(
                JSON.stringify({ ok: false, error: 'Code has expired. Please request a new one.' }),
                { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } },
            );
        }

        // Check code match
        if (org.otp_code !== String(code).trim()) {
            return new Response(
                JSON.stringify({ ok: false, error: 'Incorrect code. Please try again.' }),
                { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } },
            );
        }

        // ✓ Correct — clear OTP so it can't be reused
        await supabase
            .from('organizations')
            .update({ otp_code: null, otp_expires_at: null })
            .eq('id', orgId);

        console.log(`[verify-otp] org=${orgId} verified OK`);

        return new Response(
            JSON.stringify({ ok: true }),
            { headers: { ...CORS, 'Content-Type': 'application/json' } },
        );

    } catch (err: any) {
        console.error('[verify-otp] error:', err.message);
        return new Response(
            JSON.stringify({ ok: false, error: err.message }),
            { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } },
        );
    }
});
