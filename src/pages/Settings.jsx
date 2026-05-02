import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Button } from '../components/ui/Primitives';
import { useAppContext } from '../context/AppContext';
import { useToast } from '../components/ui/Toast';
import { supabase, isSupabaseReady } from '../lib/supabase';
import { Database, Trash2, ArrowLeft, KeyRound, Eye, EyeOff, ShieldCheck } from 'lucide-react';

const hashPassword = async (text) => {
    const msgUint8 = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

const ROLE_LABELS = { owner: 'Owner', staff: 'Staff', view: 'View' };

const Settings = () => {
    const { seedDummyData, authSession, orgId } = useAppContext();
    const navigate = useNavigate();
    const { toast } = useToast();
    const isOwner = authSession?.role === 'owner' || authSession?.role === 'super-admin';

    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deleteInput, setDeleteInput] = useState('');
    const [isDeleting, setIsDeleting] = useState(false);

    // Passcode management state
    const [editingRole, setEditingRole] = useState(null); // 'owner' | 'staff' | 'view' | null
    const [newPasscode, setNewPasscode] = useState('');
    const [showNewPass, setShowNewPass] = useState(false);
    const [savingPasscode, setSavingPasscode] = useState(false);

    // 2FA / OTP state
    const [otpEnabled, setOtpEnabled]   = useState(false);
    const [otpEmail, setOtpEmail]       = useState('');
    const [otpLoaded, setOtpLoaded]     = useState(false);
    const [savingOtp, setSavingOtp]     = useState(false);

    // Load current OTP settings
    React.useEffect(() => {
        if (!isOwner || !isSupabaseReady() || !orgId) return;
        supabase
            .from('organizations')
            .select('otp_enabled, otp_email')
            .eq('id', orgId)
            .single()
            .then(({ data }) => {
                if (data) {
                    setOtpEnabled(!!data.otp_enabled);
                    setOtpEmail(data.otp_email || '');
                }
                setOtpLoaded(true);
            });
    }, [isOwner, orgId]);

    const handleOtpSave = async () => {
        if (otpEnabled && !otpEmail.includes('@')) {
            toast.error('Enter a valid email address to receive OTP codes.');
            return;
        }
        if (!isSupabaseReady() || !orgId) {
            toast.error('Supabase not connected.');
            return;
        }
        setSavingOtp(true);
        try {
            const { error } = await supabase
                .from('organizations')
                .update({ otp_enabled: otpEnabled, otp_email: otpEmail })
                .eq('id', orgId);
            if (error) throw error;
            toast.success(otpEnabled ? '2FA enabled. OTP will be required at owner login.' : '2FA disabled.');
        } catch (err) {
            toast.error('Failed to save: ' + err.message);
        } finally {
            setSavingOtp(false);
        }
    };

    const handleSeed = () => {
        const msg = seedDummyData();
        toast.success(msg);
    };

    const handleClearData = async () => {
        if (deleteInput !== 'DELETE') return;
        setIsDeleting(true);
        try {
            if (orgId) {
                const { error: txErr } = await supabase.from('transactions').delete().eq('org_id', orgId);
                const { error: cErr  } = await supabase.from('customers').delete().eq('org_id', orgId);
                if (txErr || cErr) {
                    toast.error('Cloud delete failed. Try again.');
                    return;
                }
            }
            const keys = [
                'bt_customers', 'bt_transactions', 'bt_deleted_transactions', 'bt_auth', 'bt_chit_schemes',
                'bt_retail', 'bt_bullion', 'bt_silver', 'bt_chit',
                'bullionTracker_customers', 'bullionTracker_transactions', 'bullionTracker_retail',
                'bullionTracker_bullion', 'bullionTracker_silver', 'bullionTracker_chit',
            ];
            keys.forEach(k => localStorage.removeItem(k));
            toast.success('All data deleted. Reloading…');
            setTimeout(() => window.location.reload(), 1200);
        } finally {
            setIsDeleting(false);
            setShowDeleteConfirm(false);
            setDeleteInput('');
        }
    };

    const closeConfirm = () => { setShowDeleteConfirm(false); setDeleteInput(''); };

    const handlePasscodeEdit = (role) => {
        setEditingRole(role);
        setNewPasscode('');
        setShowNewPass(false);
    };

    const handlePasscodeCancel = () => {
        setEditingRole(null);
        setNewPasscode('');
    };

    const handlePasscodeSave = async (role) => {
        if (newPasscode.length < 4) {
            toast.error('Passcode must be at least 4 characters.');
            return;
        }
        if (!isSupabaseReady() || !orgId) {
            toast.error('Supabase not connected. Cannot save passcode.');
            return;
        }
        setSavingPasscode(true);
        try {
            const hash = await hashPassword(newPasscode);
            const { error } = await supabase
                .from('organizations')
                .update({ [`passcode_${role}_hash`]: hash })
                .eq('id', orgId);
            if (error) throw error;
            toast.success(`${ROLE_LABELS[role]} passcode updated.`);
            setEditingRole(null);
            setNewPasscode('');
        } catch (err) {
            toast.error('Failed to save: ' + err.message);
        } finally {
            setSavingPasscode(false);
        }
    };

    return (
        <div className="module-container animate-fade-in" style={{ padding: '2rem', maxWidth: '600px', margin: '0 auto' }}>
            <Card className="glass-card" style={{ padding: '2rem' }}>
                <h2 style={{ marginBottom: '1.5rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '4px' }}>
                        <ArrowLeft size={20} />
                    </button>
                    Application Settings
                </h2>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                    <div>
                        <h3 style={{ marginBottom: '0.5rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <Database size={16} /> Development Tools
                        </h3>
                        <p style={{ marginBottom: '1rem', fontSize: '0.875rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                            Populate the app with sample customers, trades, and bills to explore the ledger functions.
                            This will overwrite existing data.
                        </p>
                        <Button variant="primary" onClick={handleSeed}>
                            Load Dummy Data
                        </Button>
                    </div>

                    {/* Access Passcodes — owner only */}
                    {isOwner && (
                        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '2rem' }}>
                            <h3 style={{ marginBottom: '0.5rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <KeyRound size={16} /> Access Passcodes
                            </h3>
                            <p style={{ marginBottom: '1.25rem', fontSize: '0.875rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                                Change the login passcode for each role. Staff will need to use the new passcode immediately after saving.
                            </p>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                {(['owner', 'staff', 'view']).map(role => (
                                    <div key={role}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.65rem 0.875rem', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '10px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                                <span style={{ fontSize: '1.1rem' }}>
                                                    {role === 'owner' ? '👑' : role === 'staff' ? '👤' : '👁'}
                                                </span>
                                                <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>{ROLE_LABELS[role]}</span>
                                            </div>
                                            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', letterSpacing: '0.15em' }}>••••••</span>
                                            <button
                                                onClick={() => editingRole === role ? handlePasscodeCancel() : handlePasscodeEdit(role)}
                                                style={{
                                                    padding: '0.35rem 0.75rem',
                                                    background: editingRole === role ? 'rgba(255,255,255,0.05)' : 'rgba(59,130,246,0.12)',
                                                    border: `1px solid ${editingRole === role ? 'rgba(255,255,255,0.1)' : 'rgba(59,130,246,0.3)'}`,
                                                    borderRadius: '6px',
                                                    color: editingRole === role ? 'var(--text-muted)' : 'var(--accent-blue, #3b82f6)',
                                                    cursor: 'pointer',
                                                    fontSize: '0.8rem',
                                                    fontWeight: 600,
                                                }}
                                            >
                                                {editingRole === role ? 'Cancel' : 'Change'}
                                            </button>
                                        </div>

                                        {editingRole === role && (
                                            <div style={{ marginTop: '0.5rem', padding: '0.875rem', background: 'rgba(59,130,246,0.05)', border: '1px solid rgba(59,130,246,0.15)', borderRadius: '10px', display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                                                <div style={{ flex: 1, position: 'relative' }}>
                                                    <input
                                                        type={showNewPass ? 'text' : 'password'}
                                                        value={newPasscode}
                                                        onChange={e => setNewPasscode(e.target.value)}
                                                        placeholder="New passcode (min 4 chars)"
                                                        autoFocus
                                                        style={{
                                                            width: '100%', padding: '0.55rem 2.2rem 0.55rem 0.75rem',
                                                            background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)',
                                                            borderRadius: '7px', color: 'var(--text-primary)',
                                                            fontSize: '0.875rem', outline: 'none', boxSizing: 'border-box',
                                                        }}
                                                    />
                                                    <button type="button" onClick={() => setShowNewPass(!showNewPass)}
                                                        style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px', display: 'flex' }}>
                                                        {showNewPass ? <EyeOff size={15} /> : <Eye size={15} />}
                                                    </button>
                                                </div>
                                                <button
                                                    onClick={() => handlePasscodeSave(role)}
                                                    disabled={savingPasscode || newPasscode.length < 4}
                                                    style={{
                                                        padding: '0.55rem 1rem',
                                                        background: newPasscode.length >= 4 ? 'var(--accent-blue, #3b82f6)' : 'rgba(59,130,246,0.2)',
                                                        border: 'none', borderRadius: '7px',
                                                        color: newPasscode.length >= 4 ? '#fff' : 'rgba(59,130,246,0.5)',
                                                        cursor: newPasscode.length >= 4 ? 'pointer' : 'not-allowed',
                                                        fontSize: '0.85rem', fontWeight: 700, whiteSpace: 'nowrap',
                                                    }}
                                                >
                                                    {savingPasscode ? 'Saving…' : 'Save'}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Two-Factor Authentication — owner only */}
                    {isOwner && (
                        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '2rem' }}>
                            <h3 style={{ marginBottom: '0.5rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <ShieldCheck size={16} /> Two-Factor Authentication (OTP)
                            </h3>
                            <p style={{ marginBottom: '1.25rem', fontSize: '0.875rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                                When enabled, the owner login requires a 6-digit code sent to your email after the passcode is accepted. Requires email setup via Resend (coming soon — test mode shows the code on screen for now).
                            </p>

                            {/* Enable toggle */}
                            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.65rem 0.875rem', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '10px', cursor: 'pointer', marginBottom: '0.75rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                    <ShieldCheck size={16} style={{ color: otpEnabled ? '#10b981' : 'var(--text-muted)' }} />
                                    <div>
                                        <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>
                                            {otpEnabled ? 'Enabled' : 'Disabled'}
                                        </div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                            {otpEnabled ? 'OTP required at owner login' : 'OTP step skipped at login'}
                                        </div>
                                    </div>
                                </div>
                                {/* Toggle switch */}
                                <div
                                    onClick={() => setOtpEnabled(v => !v)}
                                    style={{
                                        width: '44px', height: '24px', borderRadius: '12px',
                                        background: otpEnabled ? '#10b981' : 'rgba(255,255,255,0.12)',
                                        position: 'relative', cursor: 'pointer',
                                        transition: 'background 0.2s', flexShrink: 0,
                                        border: 'none',
                                    }}
                                >
                                    <div style={{
                                        position: 'absolute', top: '3px',
                                        left: otpEnabled ? '22px' : '3px',
                                        width: '18px', height: '18px', borderRadius: '50%',
                                        background: '#fff',
                                        transition: 'left 0.2s',
                                        boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                                    }} />
                                </div>
                            </label>

                            {/* Email field — shown when enabled */}
                            {otpEnabled && (
                                <div style={{ marginBottom: '0.75rem' }}>
                                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                                        OTP delivery email
                                    </label>
                                    <input
                                        type="email"
                                        placeholder="e.g. jjledgerpro@gmail.com"
                                        value={otpEmail}
                                        onChange={e => setOtpEmail(e.target.value)}
                                        style={{
                                            width: '100%', padding: '0.55rem 0.75rem',
                                            background: 'rgba(0,0,0,0.2)',
                                            border: '1px solid rgba(255,255,255,0.1)',
                                            borderRadius: '8px', color: 'var(--text-primary)',
                                            fontSize: '0.875rem', outline: 'none', boxSizing: 'border-box',
                                        }}
                                    />
                                    <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                                        ⚠ Email sending requires Resend setup (not yet configured). In test mode, the code is shown on the login screen.
                                    </p>
                                </div>
                            )}

                            <button
                                onClick={handleOtpSave}
                                disabled={savingOtp || !otpLoaded}
                                style={{
                                    padding: '0.55rem 1.25rem',
                                    background: 'rgba(59,130,246,0.15)',
                                    border: '1px solid rgba(59,130,246,0.3)',
                                    borderRadius: '8px',
                                    color: 'var(--accent-blue, #3b82f6)',
                                    cursor: 'pointer',
                                    fontSize: '0.85rem', fontWeight: 700,
                                }}
                            >
                                {savingOtp ? 'Saving…' : 'Save 2FA Settings'}
                            </button>
                        </div>
                    )}

                    {isOwner && (
                        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '2rem' }}>
                            <h3 style={{ marginBottom: '0.5rem', color: 'var(--accent-red)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <Trash2 size={16} /> Danger Zone
                            </h3>
                            <p style={{ marginBottom: '1rem', fontSize: '0.875rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                                Permanently delete all customers and transactions from all devices and the cloud. This cannot be undone.
                            </p>
                            <Button variant="danger" onClick={() => setShowDeleteConfirm(true)}>
                                Clear All Data
                            </Button>
                        </div>
                    )}
                </div>
            </Card>

            {/* Delete Confirmation Modal */}
            {showDeleteConfirm && (
                <div
                    className="popup-overlay animate-fade-in"
                    onClick={closeConfirm}
                    style={{ zIndex: 1100 }}
                >
                    <div
                        className="glass-panel slide-up"
                        onClick={e => e.stopPropagation()}
                        style={{ maxWidth: '380px', width: '90%', padding: '2rem', borderRadius: '16px', border: '1px solid rgba(239,68,68,0.3)' }}
                    >
                        <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
                            <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>⚠️</div>
                            <h3 style={{ color: '#ef4444', marginBottom: '0.5rem' }}>Delete All Data?</h3>
                            <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                                This will permanently delete all customers and transactions from <strong>all devices and the cloud</strong>. <strong>This cannot be undone.</strong>
                            </p>
                        </div>

                        <div style={{ marginBottom: '1.25rem' }}>
                            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                                Type <span style={{ fontFamily: 'monospace', background: 'rgba(239,68,68,0.15)', color: '#ef4444', padding: '2px 6px', borderRadius: '4px' }}>DELETE</span> to confirm:
                            </p>
                            <input
                                type="text"
                                value={deleteInput}
                                onChange={e => setDeleteInput(e.target.value)}
                                placeholder="Type DELETE here"
                                autoFocus
                                style={{
                                    width: '100%', padding: '0.6rem 0.75rem',
                                    background: 'rgba(255,255,255,0.05)',
                                    border: `1px solid ${deleteInput === 'DELETE' ? '#ef4444' : 'rgba(255,255,255,0.1)'}`,
                                    borderRadius: '8px', color: 'var(--text-primary)',
                                    fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box'
                                }}
                            />
                        </div>

                        <div style={{ display: 'flex', gap: '0.75rem' }}>
                            <button
                                onClick={handleClearData}
                                disabled={deleteInput !== 'DELETE' || isDeleting}
                                style={{
                                    flex: 1, padding: '0.65rem',
                                    background: deleteInput === 'DELETE' && !isDeleting ? '#ef4444' : 'rgba(239,68,68,0.2)',
                                    border: '1px solid rgba(239,68,68,0.4)',
                                    borderRadius: '8px',
                                    color: deleteInput === 'DELETE' && !isDeleting ? '#fff' : 'rgba(239,68,68,0.5)',
                                    cursor: deleteInput === 'DELETE' && !isDeleting ? 'pointer' : 'not-allowed',
                                    fontSize: '0.875rem', fontWeight: 700
                                }}
                            >
                                {isDeleting ? 'Deleting…' : 'Confirm Delete'}
                            </button>
                            <button
                                onClick={closeConfirm}
                                style={{
                                    flex: 1, padding: '0.65rem',
                                    background: 'rgba(255,255,255,0.05)',
                                    border: '1px solid rgba(255,255,255,0.1)',
                                    borderRadius: '8px',
                                    color: 'var(--text-secondary)',
                                    cursor: 'pointer',
                                    fontSize: '0.875rem', fontWeight: 500
                                }}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Settings;
