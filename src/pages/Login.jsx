import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Lock, UserCheck, Eye, EyeOff, Loader, ArrowLeft, ShieldCheck, RefreshCw } from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { supabase, isSupabaseReady } from '../lib/supabase';
import './Login.css';

// Internal Supabase credentials — implementation detail, never shown in UI.
// These map each role to a fixed Supabase Auth user. Passcodes the shop uses
// are stored as hashes in the organizations table and managed from Settings.
const ROLE_EMAIL = {
    owner: 'owner@jjledger.com',
    staff: 'staff@jjledger.com',
    view:  'view@jjledger.com',
};
const ROLE_PASS = {
    owner: 'owner123',
    staff: 'staff123',
    view:  'view123',
};

// Fallback SHA-256 hashes for default passcodes (used when Supabase unavailable)
const FALLBACK_HASHES = {
    owner: '43a0d17178a9d26c9e0fe9a74b0b45e38d32f27aed887a008a54bf6e033bf7b9',
    staff: '10176e7b7b24d317acfcf8d2064cfd2f24e154f7b5a96603077d5ef813d6a6b6',
    view:  '656d604dfdba41a262963cce53699bbc56cd7a2c0da1ad5ead45fc49214159d6',
};

const ROLE_CONFIG = {
    owner: { label: 'Owner', icon: '👑', accent: 'gold',  title: 'Owner Sign In' },
    staff: { label: 'Staff', icon: '👤', accent: 'blue',  title: 'Staff Sign In' },
    view:  { label: 'View',  icon: '👁', accent: 'muted', title: 'View Access'   },
};

const OTP_LENGTH = 6;
const RESEND_COOLDOWN = 30; // seconds

const hashPassword = async (text) => {
    const msgUint8 = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

// ── OTP digit boxes ───────────────────────────────────────────────────────────
const OtpInput = ({ value, onChange, onComplete }) => {
    const refs = Array.from({ length: OTP_LENGTH }, () => useRef(null));

    const handleChange = (idx, e) => {
        const char = e.target.value.replace(/\D/g, '').slice(-1);
        const next = value.split('');
        next[idx] = char;
        const newVal = next.join('');
        onChange(newVal);
        // auto-advance
        if (char && idx < OTP_LENGTH - 1) refs[idx + 1].current?.focus();
        if (newVal.replace(/\s/g, '').length === OTP_LENGTH && !newVal.includes('')) onComplete?.(newVal);
    };

    const handleKeyDown = (idx, e) => {
        if (e.key === 'Backspace') {
            if (!value[idx] && idx > 0) refs[idx - 1].current?.focus();
        } else if (e.key === 'ArrowLeft' && idx > 0) {
            refs[idx - 1].current?.focus();
        } else if (e.key === 'ArrowRight' && idx < OTP_LENGTH - 1) {
            refs[idx + 1].current?.focus();
        }
    };

    const handlePaste = (e) => {
        const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH);
        if (pasted.length > 0) {
            onChange(pasted.padEnd(OTP_LENGTH, ''));
            refs[Math.min(pasted.length, OTP_LENGTH - 1)].current?.focus();
            if (pasted.length === OTP_LENGTH) onComplete?.(pasted);
        }
        e.preventDefault();
    };

    return (
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', margin: '1.25rem 0' }}>
            {Array.from({ length: OTP_LENGTH }).map((_, i) => (
                <input
                    key={i}
                    ref={refs[i]}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={value[i] || ''}
                    onChange={e => handleChange(i, e)}
                    onKeyDown={e => handleKeyDown(i, e)}
                    onPaste={handlePaste}
                    autoFocus={i === 0}
                    style={{
                        width: '42px',
                        height: '52px',
                        textAlign: 'center',
                        fontSize: '1.4rem',
                        fontWeight: 700,
                        background: value[i] ? 'rgba(59,130,246,0.15)' : 'rgba(255,255,255,0.05)',
                        border: `2px solid ${value[i] ? 'rgba(59,130,246,0.6)' : 'rgba(255,255,255,0.12)'}`,
                        borderRadius: '10px',
                        color: 'var(--text-primary)',
                        outline: 'none',
                        transition: 'border-color 0.15s, background 0.15s',
                        caretColor: 'transparent',
                    }}
                />
            ))}
        </div>
    );
};

// ── Main component ────────────────────────────────────────────────────────────
const Login = () => {
    const { setAuthSession } = useAppContext();

    // Navigation state
    const [loginStep, setLoginStep]     = useState(1); // 1=role, 2=passcode, 3=OTP
    const [selectedRole, setSelectedRole] = useState(null);

    // Passcode step
    const [password, setPassword]       = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError]             = useState('');
    const [loading, setLoading]         = useState(false);

    // OTP step
    const [otpValue, setOtpValue]       = useState('');
    const [otpError, setOtpError]       = useState('');
    const [otpLoading, setOtpLoading]   = useState(false);
    const [testOtp, setTestOtp]         = useState('');   // stub only — cleared when Resend is wired
    const [resendTimer, setResendTimer] = useState(0);    // countdown seconds
    const orgIdRef                      = useRef(null);   // stored after passcode verified

    // Dev mode
    const [devMode, setDevMode] = useState(false);

    // Org data (fetched once on mount)
    const [orgHashes, setOrgHashes]     = useState(null); // passcode hashes
    const [otpEnabled, setOtpEnabled]   = useState(false);
    const [otpEmail, setOtpEmail]       = useState('');

    useEffect(() => {
        const checkHash = () => setDevMode(window.location.hash === '#devmode');
        checkHash();
        window.addEventListener('hashchange', checkHash);
        return () => window.removeEventListener('hashchange', checkHash);
    }, []);

    // Fetch org passcode hashes + OTP settings
    useEffect(() => {
        if (!isSupabaseReady()) return;
        supabase
            .from('organizations')
            .select('id, passcode_owner_hash, passcode_staff_hash, passcode_view_hash, otp_enabled, otp_email')
            .single()
            .then(({ data }) => {
                if (data) {
                    setOrgHashes(data);
                    setOtpEnabled(!!data.otp_enabled);
                    setOtpEmail(data.otp_email || '');
                    orgIdRef.current = data.id;
                }
            });
    }, []);

    // Resend countdown timer
    useEffect(() => {
        if (resendTimer <= 0) return;
        const id = setInterval(() => setResendTimer(t => t - 1), 1000);
        return () => clearInterval(id);
    }, [resendTimer]);

    // ── Helpers ───────────────────────────────────────────────────────────────
    const goBack = () => {
        if (loginStep === 3) {
            setLoginStep(2);
            setOtpValue('');
            setOtpError('');
            setTestOtp('');
        } else {
            setSelectedRole(null);
            setLoginStep(1);
            setError('');
            setPassword('');
            setLoading(false);
        }
    };

    const handleRoleSelect = (role) => {
        setSelectedRole(role);
        setLoginStep(2);
        setError('');
        setPassword('');
    };

    // Called once passcode is correct — sends OTP or does final signIn
    const doSignIn = useCallback(async () => {
        const { error: authError } = await supabase.auth.signInWithPassword({
            email:    ROLE_EMAIL[selectedRole],
            password: ROLE_PASS[selectedRole],
        });
        if (authError) {
            setError('Authentication failed. Contact administrator.');
            setLoading(false);
        }
        // On success: leave spinner; AppContext.onAuthStateChange unmounts Login
    }, [selectedRole]);

    const sendOtp = useCallback(async () => {
        setOtpLoading(true);
        setOtpError('');
        setTestOtp('');
        try {
            const { data, error } = await supabase.functions.invoke('send-otp', {
                body: { orgId: orgIdRef.current },
            });
            if (error || !data?.ok) throw new Error(data?.error || error?.message || 'Failed to send OTP');
            if (data.test_otp) setTestOtp(data.test_otp); // dev stub
            setResendTimer(RESEND_COOLDOWN);
        } catch (err) {
            setOtpError(err.message);
        } finally {
            setOtpLoading(false);
        }
    }, []);

    // ── Passcode submit ───────────────────────────────────────────────────────
    const handleLogin = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            // Dev/super-admin shortcut
            if (devMode && password === 'admin') {
                setAuthSession({ role: 'super-admin' });
                return;
            }

            if (isSupabaseReady()) {
                // Verify passcode hash
                if (window.crypto?.subtle) {
                    const hashed       = await hashPassword(password);
                    const expectedHash = orgHashes?.[`passcode_${selectedRole}_hash`] || FALLBACK_HASHES[selectedRole];
                    if (hashed !== expectedHash) {
                        setError('Invalid passcode.');
                        return;
                    }
                }

                // Owner + OTP enabled → send OTP and advance to Step 3
                if (selectedRole === 'owner' && otpEnabled) {
                    setLoading(false);
                    setLoginStep(3);
                    setOtpValue('');
                    setOtpError('');
                    // Fire-and-forget OTP send (spinner shows inside OTP step)
                    sendOtp();
                    return;
                }

                // No OTP — sign in directly
                await doSignIn();
                return;
            }

            // ── Offline fallback ─────────────────────────────────────────────
            if (!window.crypto?.subtle) {
                if (ROLE_PASS[selectedRole] === password) setAuthSession({ role: selectedRole });
                else setError('Invalid passcode.');
                return;
            }

            const hashed = await hashPassword(password);
            if (hashed === FALLBACK_HASHES[selectedRole]) setAuthSession({ role: selectedRole });
            else setError('Invalid passcode.');

        } catch (err) {
            console.error(err);
            setError('Login error: ' + err.message);
        } finally {
            // Only clear spinner if we didn't hand off to Supabase auth or OTP
            if (loginStep !== 3) setLoading(false);
        }
    };

    // ── OTP verify ────────────────────────────────────────────────────────────
    const handleOtpVerify = async (code) => {
        const digits = (code || otpValue).replace(/\s/g, '');
        if (digits.length !== OTP_LENGTH) return;
        setOtpLoading(true);
        setOtpError('');
        try {
            const { data, error } = await supabase.functions.invoke('verify-otp', {
                body: { orgId: orgIdRef.current, code: digits },
            });
            if (error || !data?.ok) throw new Error(data?.error || error?.message || 'Verification failed');
            // OTP correct — proceed with Supabase Auth (spinner stays on)
            setLoading(true);
            await doSignIn();
        } catch (err) {
            setOtpError(err.message);
            setOtpLoading(false);
        }
    };

    // ── Render ────────────────────────────────────────────────────────────────
    const roleConfig = selectedRole ? ROLE_CONFIG[selectedRole] : null;

    return (
        <div className="login-container">
            <div className="login-card glass-panel animate-fade-in">

                {/* Header */}
                <div className="login-header">
                    <div className="login-icon-wrap">
                        {loginStep === 3
                            ? <ShieldCheck size={32} style={{ color: '#3b82f6' }} />
                            : <Lock size={32} className="text-blue" />
                        }
                    </div>
                    <h2>JJ Jewellers</h2>
                    <p>JJ Ledger Pro</p>
                </div>

                {/* ══ STEP 1 — Role selector ══ */}
                {loginStep === 1 && (
                    <div>
                        <p className="login-step-label">Select your role to continue</p>
                        <div className="role-grid">
                            {Object.entries(ROLE_CONFIG).map(([role, cfg]) => (
                                <button
                                    key={role}
                                    className={`role-tile role-tile-${cfg.accent}`}
                                    onClick={() => handleRoleSelect(role)}
                                    type="button"
                                >
                                    <span className="role-tile-icon">{cfg.icon}</span>
                                    <span className="role-tile-label">{cfg.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* ══ STEP 2 — Passcode ══ */}
                {loginStep === 2 && (
                    <div>
                        <div className="login-step-header">
                            <button className="login-back-btn" onClick={goBack} type="button">
                                <ArrowLeft size={18} />
                            </button>
                            <span className="login-step-title">{roleConfig.title}</span>
                        </div>

                        <form onSubmit={handleLogin} className="login-form">
                            <div className="input-group" style={{ position: 'relative' }}>
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    placeholder="Enter Passcode..."
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    autoFocus
                                    disabled={loading}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    style={{
                                        position: 'absolute', right: '12px', top: '50%',
                                        transform: 'translateY(-50%)', background: 'none',
                                        border: 'none', color: 'var(--text-muted)',
                                        cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center',
                                    }}
                                >
                                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>
                            {error && <div className="login-error">{error}</div>}

                            <button type="submit" className="login-btn" disabled={loading || !password}>
                                {loading
                                    ? <><Loader size={18} className="spin" /> Signing in…</>
                                    : <><UserCheck size={18} /> Sign In</>
                                }
                            </button>
                        </form>

                        <p className="login-footer-hint">Contact your administrator for your access code</p>
                    </div>
                )}

                {/* ══ STEP 3 — OTP verification (owner only) ══ */}
                {loginStep === 3 && (
                    <div>
                        <div className="login-step-header">
                            <button className="login-back-btn" onClick={goBack} type="button" disabled={otpLoading || loading}>
                                <ArrowLeft size={18} />
                            </button>
                            <span className="login-step-title">Two-Factor Verification</span>
                        </div>

                        <div style={{ textAlign: 'center', margin: '0.5rem 0 0' }}>
                            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                                {otpEmail
                                    ? <>A 6-digit code was sent to <strong style={{ color: 'var(--text-secondary)' }}>{otpEmail}</strong></>
                                    : 'Enter the 6-digit code from your registered email'
                                }
                            </p>
                        </div>

                        <OtpInput
                            value={otpValue}
                            onChange={setOtpValue}
                            onComplete={handleOtpVerify}
                        />

                        {/* Test-mode hint — only shown when Edge Function returns test_otp */}
                        {testOtp && (
                            <div style={{
                                textAlign: 'center',
                                padding: '0.5rem 0.75rem',
                                background: 'rgba(245,158,11,0.1)',
                                border: '1px solid rgba(245,158,11,0.25)',
                                borderRadius: '8px',
                                marginBottom: '0.75rem',
                            }}>
                                <span style={{ fontSize: '0.75rem', color: '#f59e0b' }}>
                                    🧪 Test mode — code: <strong style={{ letterSpacing: '0.15em', fontFamily: 'monospace' }}>{testOtp}</strong>
                                </span>
                            </div>
                        )}

                        {otpError && <div className="login-error">{otpError}</div>}

                        <button
                            className="login-btn"
                            onClick={() => handleOtpVerify()}
                            disabled={otpLoading || loading || otpValue.replace(/\s/g, '').length < OTP_LENGTH}
                            style={{ marginBottom: '0.75rem' }}
                        >
                            {otpLoading || loading
                                ? <><Loader size={18} className="spin" /> Verifying…</>
                                : <><ShieldCheck size={18} /> Verify Code</>
                            }
                        </button>

                        {/* Resend */}
                        <div style={{ textAlign: 'center' }}>
                            {resendTimer > 0 ? (
                                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                    Resend in {resendTimer}s
                                </span>
                            ) : (
                                <button
                                    type="button"
                                    onClick={sendOtp}
                                    disabled={otpLoading}
                                    style={{
                                        background: 'none', border: 'none',
                                        color: 'var(--accent-blue, #3b82f6)',
                                        cursor: 'pointer', fontSize: '0.82rem',
                                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                                    }}
                                >
                                    <RefreshCw size={13} /> Resend code
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {devMode && (
                    <div className="dev-banner">Super Admin Mode Active (Pass: admin)</div>
                )}
            </div>
        </div>
    );
};

export default Login;
