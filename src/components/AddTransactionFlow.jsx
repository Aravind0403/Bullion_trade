import React, { useState, useRef, useMemo } from 'react';
import {
    Search, X, Check, Camera, XCircle,
    CalendarDays, Phone, ArrowRight, ChevronLeft,
    TrendingUp, TrendingDown
} from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import ReceiptModal from './ReceiptModal';
import { compressImage, uploadToCloudinary } from '../utils/imageUtils';
import './TransactionPopup.css';
import './AddTransactionFlow.css';

// ── Category config ───────────────────────────────────────────────────────────
const CAT = {
    RETAIL:  { label: 'RETAIL',  color: '#3b82f6', sub: ['CASH', 'METAL'] },
    BULLION: { label: 'BULLION', color: '#f59e0b', sub: ['GOLD', 'SILVER'] },
    SILVER:  { label: 'SILVER',  color: '#94a3b8', sub: ['CASH', 'SILVER'] },
    CHIT:    { label: 'CHIT',    color: '#10b981', sub: null },
};

// ── Core logic rules ──────────────────────────────────────────────────────────
//
// RETAIL (CASH or METAL) → cashBalance tracks ₹  — bill amount drives balance
// BULLION GOLD           → goldBalance tracks g  — grams drives balance
// BULLION SILVER         → silverBalance tracks g — grams drives balance
// SILVER CASH  → silverCash tracks ₹   — bill amount drives balance
// SILVER SILVER → silverSilver tracks g — grams drive balance (like BULLION)
// CHIT                   → cashBalance tracks ₹  — bill amount drives balance
//
// "showGrams"      → show the grams weight input (informational for RETAIL/SILVER)
// "gramsIsBalance" → grams ARE the balance amount (only BULLION)

const getTxType = (cat, sub) => {
    if (cat === 'BULLION' && sub === 'GOLD')   return 'GOLD';
    if (cat === 'BULLION' && sub === 'SILVER') return 'SILVER';
    if (cat === 'SILVER'  && sub === 'SILVER') return 'SILVER'; // grams-based silver balance
    return 'CASH'; // RETAIL CASH/METAL, SILVER CASH, CHIT — all track ₹
};

// Show the grams input field?
const showGrams = (cat, sub) =>
    (cat === 'RETAIL'  && sub === 'METAL')  ||
    cat === 'BULLION'                       ||
    (cat === 'SILVER'  && sub === 'SILVER');

// Are grams the primary balance amount?
// BULLION (gold/silver) and SILVER·SILVER both track grams as the balance.
const gramsIsBalance = (cat, sub) =>
    cat === 'BULLION' || (cat === 'SILVER' && sub === 'SILVER');

const getCatLabel = (cat, sub) => {
    if (cat === 'RETAIL'  && sub === 'CASH')   return 'Retail — Cash';
    if (cat === 'RETAIL'  && sub === 'METAL')  return 'Retail — Metal';
    if (cat === 'BULLION' && sub === 'GOLD')   return 'Bullion Gold';
    if (cat === 'BULLION' && sub === 'SILVER') return 'Bullion Silver';
    if (cat === 'SILVER'  && sub === 'CASH')   return 'Silver — Cash';
    if (cat === 'SILVER'  && sub === 'SILVER') return 'Silver — Silver';
    if (cat === 'CHIT')                        return 'Chit Fund';
    return 'New Transaction';
};

// Grams field label — uses metalType for RETAIL/SILVER METAL, subType for BULLION
const getGramsLabel = (operation, cat, sub, metalType) => {
    const metal = cat === 'BULLION'
        ? (sub === 'GOLD' ? 'Gold' : 'Silver')
        : (metalType === 'GOLD' ? 'Gold' : 'Silver');
    // For BULLION and SILVER·SILVER, grams = the actual balance. For RETAIL/SILVER CASH, grams = informational only.
    const note = (cat === 'BULLION' || (cat === 'SILVER' && sub === 'SILVER')) ? '' : ' (info only)';
    return operation === 'YOU_GOT'
        ? `${metal} Weight Received${note} (g)`
        : `${metal} Weight Given${note} (g)`;
};

const getBillLabel = (operation, isGramsBalance) => {
    // For BULLION, bill amount is just a ₹ reference — not the balance
    if (isGramsBalance) return 'Reference ₹ Value (optional)';
    return operation === 'YOU_GOT' ? 'Bill Amount Received (₹)' : 'Bill Amount Given (₹)';
};

const fmt  = (v) => parseFloat(v || 0).toFixed(2);
const fmtG = (v) => parseFloat(v || 0).toFixed(3);

const genWhatsApp = (customer, newTx, prevTxs = []) => {
    // ── New transaction line ─────────────────────────────────────────────────
    const isGot      = newTx.operation === 'YOU_GOT';
    const isGramsTx  = newTx.gramsIsBal;
    const newAmt     = isGramsTx
        ? `${fmtG(newTx.primaryAmount)}g`
        : `₹${fmt(newTx.primaryAmount)}`;
    const txLabel    = isGot ? `We received ${newAmt}` : `We gave ${newAmt}`;
    const catLine    = newTx.category + (newTx.subType ? ` (${newTx.subType})` : '');
    const descLine   = newTx.description ? `\nNote: ${newTx.description}` : '';

    // ── Updated balance ──────────────────────────────────────────────────────
    const cash   = parseFloat(customer.cashBalance   || 0);
    const gold   = parseFloat(customer.goldBalance   || 0);
    const silver = parseFloat(customer.silverBalance || 0);
    const balParts = [];
    if (cash   !== 0) balParts.push(`₹${fmt(Math.abs(cash))} ${cash >= 0 ? '(you owe us)' : '(we owe you)'}`);
    if (gold   !== 0) balParts.push(`${fmtG(Math.abs(gold))}g gold ${gold >= 0 ? '(you owe us)' : '(we owe you)'}`);
    if (silver !== 0) balParts.push(`${fmtG(Math.abs(silver))}g silver ${silver >= 0 ? '(you owe us)' : '(we owe you)'}`);
    const balStr = balParts.length ? balParts.join(', ') : 'Nil';

    const due = customer.due_date
        ? new Date(customer.due_date).toLocaleDateString('en-IN')
        : null;

    // ── Last 5 transactions history ──────────────────────────────────────────
    let historyBlock = '';
    if (prevTxs.length > 0) {
        const lines = prevTxs.map(t => {
            const tGot   = t.jama > 0;
            const tAmt   = tGot ? t.jama : t.nave;
            const tGrams = t.type === 'GOLD' || t.type === 'SILVER';
            const tAmtStr = tGrams ? `${fmtG(tAmt)}g` : `₹${fmt(tAmt)}`;
            const tCat   = [t.category, t.sub_type].filter(Boolean).join('·');
            return `  ${t.date}  ${tGot ? '+' : '−'}${tAmtStr}  ${tCat}${t.description ? ' ' + t.description : ''}`;
        });
        historyBlock = `\n\n*Recent transactions:*\n${lines.join('\n')}`;
    }

    const text = [
        `Dear ${customer.name},`,
        ``,
        `*New transaction — JJ Jewellers*`,
        `${txLabel}  |  ${catLine}  |  ${newTx.date}${descLine}`,
        ``,
        `*Current balance:* ${balStr}`,
        due ? `*Due date:* ${due}` : null,
        historyBlock || null,
        ``,
        `— JJ Jewellers`,
    ].filter(l => l !== null).join('\n');

    let mob = customer.mobile;
    if (!mob.startsWith('91')) mob = '91' + mob;
    return `https://wa.me/${mob}?text=${encodeURIComponent(text)}`;
};

// ── Component ─────────────────────────────────────────────────────────────────
const AddTransactionFlow = ({ onClose, presetCustomerId = null }) => {
    const { customers, transactions, addTransaction, chitSchemes, addChitScheme } = useAppContext();

    const todayStr = new Date().toISOString().split('T')[0];
    const timeStr  = new Date().toTimeString().substring(0, 5);

    const [step, setStep] = useState(presetCustomerId ? 2 : 1);
    const [searchQ, setSearchQ] = useState('');
    const [selectedCustomer, setSelectedCustomer] = useState(
        presetCustomerId ? (customers.find(c => c.id === presetCustomerId) || null) : null
    );

    const [form, setForm] = useState({
        operation:     'YOU_GOT',
        category:      'RETAIL',
        subType:       'CASH',
        metalType:     'GOLD',   // which metal for RETAIL/SILVER METAL (informational)
        grams:         '',
        billAmount:    '',
        chitScheme:    '',       // populated from chitSchemes[0] on first render via effect
        newSchemeName: '',       // "add new scheme" input value
        showAddScheme: false,
        description:   '',
        date:          todayStr,
        time:          timeStr,
        dueDateToggle: false,
        dueDate:       '',
        whatsapp:      false,
        addedBy:       'Owner',
    });

    const [images,      setImages]      = useState([]);
    const [isUploading, setIsUploading] = useState(false);
    const [isSaving,    setIsSaving]    = useState(false);
    const [receiptData, setReceiptData] = useState(null);
    const fileInputRef = useRef(null);

    // ── Derived values ────────────────────────────────────────────────────────
    const txType       = getTxType(form.category, form.subType);
    const hasGrams     = showGrams(form.category, form.subType);
    const gramsIsBal   = gramsIsBalance(form.category, form.subType);
    const catColor     = CAT[form.category]?.color || '#3b82f6';
    const balUnit      = txType === 'CASH' ? '₹' : 'g';
    const balFmt       = txType === 'CASH' ? fmt : fmtG;
    const isChit       = form.category === 'CHIT';

    // The amount that actually moves the balance:
    // • BULLION → grams (weight traded between vendors)
    // • Everything else (RETAIL, SILVER, CHIT) → bill amount in ₹
    const primaryAmount = gramsIsBal
        ? parseFloat(form.grams      || 0)
        : parseFloat(form.billAmount || 0);

    const getCurrentBalance = () => {
        if (!selectedCustomer) return 0;
        if (txType === 'CASH')   return parseFloat(selectedCustomer.cashBalance   || 0);
        if (txType === 'GOLD')   return parseFloat(selectedCustomer.goldBalance   || 0);
        if (txType === 'SILVER') return parseFloat(selectedCustomer.silverBalance || 0);
        return 0;
    };

    const delta      = form.operation === 'YOU_GOT' ? primaryAmount : -primaryAmount;
    const currentBal = getCurrentBalance();
    const newBal     = currentBal + delta;
    const canSave    = primaryAmount > 0 && (!isChit || form.chitScheme.trim() !== '');

    // ── Customer search — only show results when user has typed something ────
    const filtered = searchQ.trim()
        ? customers.filter(c =>
            c.name.toLowerCase().includes(searchQ.toLowerCase()) ||
            c.mobile.includes(searchQ))
        : [];

    // ── Last 5 transactions for the selected customer ─────────────────────────
    const lastFiveTxs = useMemo(() => {
        if (!selectedCustomer) return [];
        return [...transactions]
            .filter(t => t.cid === selectedCustomer.id && !t.deleted_at)
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
            .slice(0, 5);
    }, [transactions, selectedCustomer]);

    // ── Helpers ───────────────────────────────────────────────────────────────
    const setF = (key, val) => setForm(f => ({ ...f, [key]: val }));

    const handleCategoryChange = (cat) => {
        const sub = CAT[cat].sub ? CAT[cat].sub[0] : '';
        setForm(f => ({
            ...f,
            category: cat, subType: sub,
            metalType: 'GOLD',
            grams: '', billAmount: '',
            chitScheme: cat === 'CHIT' ? (chitSchemes[0] || '') : '',
            newSchemeName: '', showAddScheme: false,
        }));
    };

    const handleAddScheme = () => {
        const name = form.newSchemeName.trim().toUpperCase();
        if (!name) return;
        addChitScheme(name);
        setForm(f => ({ ...f, chitScheme: name, newSchemeName: '', showAddScheme: false }));
    };

    const handleFileChange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        setIsUploading(true);
        try {
            const blob = await compressImage(file);
            const data = await uploadToCloudinary(blob);
            setImages(prev => [...prev, data]);
        } catch (err) {
            alert('Upload failed: ' + err.message);
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleSave = async () => {
        if (!selectedCustomer) return;
        if (!canSave) {
            if (isChit && !form.chitScheme.trim()) { alert('Select or enter a scheme name'); return; }
            alert(gramsIsBal ? 'Enter weight in grams' : 'Enter bill amount');
            return;
        }

        const jama = form.operation === 'YOU_GOT'  ? primaryAmount : 0;
        const nave = form.operation === 'YOU_GAVE' ? primaryAmount : 0;

        setIsSaving(true);
        try {
            const entry = addTransaction({
                customerId:  selectedCustomer.id,
                type:        txType,
                category:    form.category,
                sub_type:    form.subType,
                metal_type:  hasGrams && !gramsIsBal ? form.metalType : '', // RETAIL/SILVER metal type
                chit_scheme: isChit ? form.chitScheme : '',
                bill_amount: parseFloat(form.billAmount || 0),
                grams:       hasGrams ? parseFloat(form.grams || 0) : 0,
                jama,
                nave,
                description:  form.description,
                date:         form.date,
                time:         form.time,
                due_date:     form.dueDateToggle ? form.dueDate : null,
                whatsapp_sent: form.whatsapp,
                added_by:     form.addedBy,
                images,
            });

            if (form.whatsapp) {
                const newTxCtx = {
                    operation:    form.operation,
                    primaryAmount,
                    gramsIsBal,
                    category:     form.category,
                    subType:      form.subType,
                    description:  form.description,
                    date:         form.date,
                };
                window.open(genWhatsApp(selectedCustomer, newTxCtx, lastFiveTxs), '_blank');
            }
            setReceiptData({ transaction: entry, customer: selectedCustomer });
        } catch (err) {
            alert('Save failed: ' + err.message);
        } finally {
            setIsSaving(false);
        }
    };

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <>
        <div className="popup-overlay animate-fade-in">
            <div className="popup-content slide-up atf-content">

                {/* ── Header ── */}
                <div className="popup-header atf-header" style={{ borderBottom: `2px solid ${catColor}30` }}>
                    {step === 2 && !presetCustomerId && (
                        <button className="icon-btn" onClick={() => setStep(1)} style={{ marginRight: '0.5rem' }}>
                            <ChevronLeft size={22} />
                        </button>
                    )}
                    <div style={{ flex: 1 }}>
                        <h3 style={{ margin: 0, fontSize: '1.05rem' }}>
                            {step === 1 ? 'Select Customer' : getCatLabel(form.category, form.subType)}
                        </h3>
                        {step === 2 && selectedCustomer && (
                            <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                                {selectedCustomer.name} · {selectedCustomer.mobile}
                            </p>
                        )}
                    </div>
                    <button className="icon-btn" onClick={onClose}><X size={20} /></button>
                </div>

                {/* ════════════════ STEP 1 — Customer Search ════════════════ */}
                {step === 1 && (
                    <div className="popup-body">
                        <div className="search-bar">
                            <Search size={18} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                            <input
                                type="text"
                                placeholder="Search by name or mobile..."
                                value={searchQ}
                                onChange={e => setSearchQ(e.target.value)}
                                autoFocus
                            />
                            {searchQ && (
                                <button className="icon-btn" onClick={() => setSearchQ('')}>
                                    <X size={14} />
                                </button>
                            )}
                        </div>

                        <div className="customer-list-sm">
                            {!searchQ.trim() ? (
                                <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem 1rem', fontSize: '0.85rem' }}>
                                    Type a name or mobile number to find a customer
                                </p>
                            ) : filtered.length === 0 ? (
                                <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                                    No customers match "<strong>{searchQ}</strong>"
                                </p>
                            ) : (
                                filtered.map(c => (
                                    <div
                                        key={c.id}
                                        className="customer-item-sm"
                                        onClick={() => { setSelectedCustomer(c); setStep(2); }}
                                    >
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontWeight: 600 }}>{c.name}</div>
                                            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                                {c.mobile}
                                            </div>
                                        </div>
                                        <ArrowRight size={16} style={{ color: 'var(--text-muted)' }} />
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                )}

                {/* ════════════════ STEP 2 — Transaction Form ════════════════ */}
                {step === 2 && selectedCustomer && (
                    <div className="popup-body">

                        {/* ── Last 5 transactions for this customer ── */}
                        {lastFiveTxs.length > 0 && (
                            <div style={{
                                background: 'rgba(255,255,255,0.04)',
                                borderRadius: '10px',
                                border: '1px solid rgba(255,255,255,0.08)',
                                padding: '0.55rem 0.75rem',
                                marginBottom: '0.85rem',
                            }}>
                                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.07em', marginBottom: '0.4rem' }}>
                                    Last {lastFiveTxs.length} Transaction{lastFiveTxs.length > 1 ? 's' : ''}
                                </div>
                                {lastFiveTxs.map((t, i) => {
                                    const isGot   = t.jama > 0;
                                    const amt     = isGot ? t.jama : t.nave;
                                    const isGrams = t.type === 'GOLD' || t.type === 'SILVER';
                                    const amtStr  = isGrams ? `${fmtG(amt)}g` : `₹${fmt(amt)}`;
                                    const catTag  = [t.category, t.sub_type].filter(Boolean).join('·');
                                    return (
                                        <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '0.22rem 0', borderBottom: i < lastFiveTxs.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                                            <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', minWidth: '68px', flexShrink: 0 }}>{t.date}</span>
                                            <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {catTag}{t.description ? ` — ${t.description}` : ''}
                                            </span>
                                            <span style={{ fontSize: '0.76rem', fontWeight: 700, color: isGot ? '#10b981' : '#ef4444', whiteSpace: 'nowrap', flexShrink: 0 }}>
                                                {isGot ? '+' : '−'}{amtStr}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {/* YOU GOT / YOU GAVE tabs */}
                        <div className="atf-op-tabs">
                            <button
                                className={`atf-op-tab ${form.operation === 'YOU_GOT' ? 'atf-op-got' : ''}`}
                                onClick={() => setF('operation', 'YOU_GOT')}
                            >
                                <TrendingUp size={16} style={{ marginBottom: '2px' }} />
                                <span className="atf-op-main">YOU GOT</span>
                                <span className="atf-op-sub">Customer gives to shop</span>
                            </button>
                            <button
                                className={`atf-op-tab ${form.operation === 'YOU_GAVE' ? 'atf-op-gave' : ''}`}
                                onClick={() => setF('operation', 'YOU_GAVE')}
                            >
                                <TrendingDown size={16} style={{ marginBottom: '2px' }} />
                                <span className="atf-op-main">YOU GAVE</span>
                                <span className="atf-op-sub">Shop gives to customer</span>
                            </button>
                        </div>

                        {/* Category pills */}
                        <div className="form-group">
                            <label>Category</label>
                            <div className="atf-cat-pills">
                                {Object.entries(CAT).map(([key, cfg]) => (
                                    <button
                                        key={key}
                                        className={`atf-cat-pill ${form.category === key ? 'active' : ''}`}
                                        style={form.category === key
                                            ? { borderColor: cfg.color, color: cfg.color, background: `${cfg.color}18` }
                                            : {}}
                                        onClick={() => handleCategoryChange(key)}
                                    >
                                        {key}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Sub-type pills (RETAIL / BULLION / SILVER) */}
                        {CAT[form.category]?.sub && (
                            <div className="form-group">
                                <label>Sub Type</label>
                                <div className="type-pills">
                                    {CAT[form.category].sub.map(s => (
                                        <button
                                            key={s}
                                            className={`type-pill ${form.subType === s ? 'active' : ''}`}
                                            style={form.subType === s
                                                ? { borderColor: catColor, color: catColor, background: `${catColor}18` }
                                                : {}}
                                            onClick={() => setForm(f => ({ ...f, subType: s, grams: '', billAmount: '', metalType: 'GOLD' }))}
                                        >
                                            {s}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Metal type selector — RETAIL METAL or SILVER METAL only
                            (informational: which metal the customer brought) */}
                        {hasGrams && !gramsIsBal && (
                            <div className="form-group">
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                    Metal Type
                                    <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                                        — which metal is the customer bringing?
                                    </span>
                                </label>
                                <div className="type-pills">
                                    {['GOLD', 'SILVER'].map(m => (
                                        <button
                                            key={m}
                                            className={`type-pill ${form.metalType === m ? 'active' : ''}`}
                                            style={form.metalType === m
                                                ? { borderColor: m === 'GOLD' ? '#f59e0b' : '#94a3b8', color: m === 'GOLD' ? '#f59e0b' : '#94a3b8', background: m === 'GOLD' ? '#f59e0b18' : '#94a3b818' }
                                                : {}}
                                            onClick={() => setF('metalType', m)}
                                        >
                                            {m === 'GOLD' ? '🥇 Gold' : '🥈 Silver'}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* ── Chit Scheme Selector ── */}
                        {isChit && (
                            <div className="form-group">
                                <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span>
                                        {form.operation === 'YOU_GOT'
                                            ? 'Scheme — Customer is paying into'
                                            : 'Scheme — Company is paying out'}
                                    </span>
                                    <button
                                        style={{ fontSize: '0.72rem', color: catColor, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}
                                        onClick={() => setF('showAddScheme', !form.showAddScheme)}
                                    >
                                        {form.showAddScheme ? '✕ Cancel' : '＋ New Scheme'}
                                    </button>
                                </label>

                                {/* Add new scheme input */}
                                {form.showAddScheme && (
                                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                        <input
                                            type="text"
                                            placeholder="New scheme name..."
                                            value={form.newSchemeName}
                                            onChange={e => setF('newSchemeName', e.target.value)}
                                            onKeyDown={e => e.key === 'Enter' && handleAddScheme()}
                                            autoFocus
                                            style={{ flex: 1 }}
                                        />
                                        <button
                                            className="btn-save"
                                            style={{ padding: '0.5rem 0.85rem', fontSize: '0.8rem' }}
                                            onClick={handleAddScheme}
                                            disabled={!form.newSchemeName.trim()}
                                        >
                                            Add
                                        </button>
                                    </div>
                                )}

                                {/* Scheme pills — dynamic from AppContext */}
                                <div className="atf-scheme-pills">
                                    {chitSchemes.map(s => (
                                        <button
                                            key={s}
                                            className={`atf-scheme-pill ${form.chitScheme === s ? 'active' : ''}`}
                                            style={form.chitScheme === s
                                                ? { borderColor: catColor, color: catColor, background: `${catColor}18` }
                                                : {}}
                                            onClick={() => setF('chitScheme', s)}
                                        >
                                            {s}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* ── Balance bar ── */}
                        <div className="atf-balance-bar" style={{ borderColor: `${catColor}30` }}>
                            <div className="atf-bal-box">
                                <span className="atf-bal-label">CUR. BAL</span>
                                <span
                                    className="atf-bal-val"
                                    style={{ color: currentBal >= 0 ? '#10b981' : '#ef4444' }}
                                >
                                    {balUnit === '₹' ? `₹${balFmt(currentBal)}` : `${balFmt(currentBal)} g`}
                                </span>
                            </div>

                            {/* Delta indicator — shows the amount moving the balance */}
                            <div className="atf-delta-col">
                                {primaryAmount > 0 && (
                                    <span className={`atf-delta ${form.operation === 'YOU_GOT' ? 'atf-delta-up' : 'atf-delta-down'}`}>
                                        {form.operation === 'YOU_GOT' ? '▲' : '▼'}
                                        {balUnit === '₹'
                                            ? `₹${fmt(primaryAmount)}`
                                            : `${fmtG(primaryAmount)} g`}
                                    </span>
                                )}
                                <ArrowRight size={18} style={{ color: catColor }} />
                            </div>

                            <div className="atf-bal-box atf-bal-right">
                                <span className="atf-bal-label">NEW BAL</span>
                                <span
                                    className="atf-bal-val atf-new-bal"
                                    style={{ color: newBal >= 0 ? '#10b981' : '#ef4444' }}
                                >
                                    {balUnit === '₹' ? `₹${balFmt(newBal)}` : `${balFmt(newBal)} g`}
                                </span>
                            </div>
                        </div>

                        {/* ── Amount fields ── */}
                        <div className={hasGrams ? 'amount-grid' : ''}>

                            {/* Grams — shown when customer brings/receives metal */}
                            {hasGrams && (
                                <div className="form-group">
                                    <label>{getGramsLabel(form.operation, form.category, form.subType, form.metalType)}</label>
                                    <div className="atf-input-unit">
                                        <input
                                            type="number"
                                            placeholder="0.000"
                                            step="0.001"
                                            min="0"
                                            value={form.grams}
                                            onChange={e => setF('grams', e.target.value)}
                                            autoFocus={gramsIsBal}
                                        />
                                        <span className="atf-unit-badge atf-badge-g">g</span>
                                    </div>
                                    {/* For BULLION: grams = balance driver */}
                                    {gramsIsBal && (
                                        <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: '4px 0 0' }}>
                                            This updates the gram balance directly
                                        </p>
                                    )}
                                </div>
                            )}

                            {/* Bill Amount ₹ —
                                RETAIL/SILVER: PRIMARY field (drives ₹ balance)
                                BULLION:       optional reference ₹ value */}
                            <div className="form-group">
                                <label>{getBillLabel(form.operation, gramsIsBal)}</label>
                                <div className="atf-input-unit">
                                    <span className="atf-unit-badge atf-badge-rs">₹</span>
                                    <input
                                        type="number"
                                        placeholder={gramsIsBal ? 'Optional reference...' : '0.00'}
                                        step="0.01"
                                        min="0"
                                        value={form.billAmount}
                                        onChange={e => setF('billAmount', e.target.value)}
                                        autoFocus={!gramsIsBal}
                                    />
                                </div>
                                {/* For RETAIL/SILVER METAL: bill amount = ₹ balance driver */}
                                {hasGrams && !gramsIsBal && (
                                    <p style={{ fontSize: '0.7rem', color: '#10b981', margin: '4px 0 0', fontWeight: 600 }}>
                                        ← This updates the ₹ cash balance
                                    </p>
                                )}
                            </div>
                        </div>

                        {/* Description */}
                        <div className="form-group">
                            <label>Description / Notes</label>
                            <input
                                type="text"
                                placeholder="e.g., Old gold exchange, EMI payment..."
                                value={form.description}
                                onChange={e => setF('description', e.target.value)}
                            />
                        </div>

                        {/* Date & Time */}
                        <div className="datetime-row">
                            <div className="form-group" style={{ flex: 1 }}>
                                <label>Date</label>
                                <input type="date" value={form.date} onChange={e => setF('date', e.target.value)} />
                            </div>
                            <div className="form-group" style={{ flex: 1 }}>
                                <label>Time</label>
                                <input type="time" value={form.time} onChange={e => setF('time', e.target.value)} />
                            </div>
                        </div>

                        {/* Toggles */}
                        <div className="toggles-container">
                            {/* Due Date — YOU GAVE only */}
                            {form.operation === 'YOU_GAVE' && (
                                <>
                                    <label className="toggle-row">
                                        <div className="toggle-info">
                                            <CalendarDays size={16} />
                                            <span>Set Due Date</span>
                                        </div>
                                        <input
                                            type="checkbox"
                                            checked={form.dueDateToggle}
                                            onChange={e => setF('dueDateToggle', e.target.checked)}
                                        />
                                    </label>
                                    {form.dueDateToggle && (
                                        <input
                                            type="date"
                                            className="due-date-input"
                                            value={form.dueDate}
                                            onChange={e => setF('dueDate', e.target.value)}
                                        />
                                    )}
                                </>
                            )}

                            {/* WhatsApp */}
                            <label className="toggle-row">
                                <div className="toggle-info">
                                    <Phone size={16} />
                                    <span>Send WhatsApp Notification</span>
                                </div>
                                <input
                                    type="checkbox"
                                    checked={form.whatsapp}
                                    onChange={e => setF('whatsapp', e.target.checked)}
                                />
                            </label>
                        </div>

                        {/* Photo Upload */}
                        <div className="form-group">
                            <label>Receipt Photo</label>
                            <div className="image-uploader">
                                <input
                                    type="file"
                                    accept="image/*"
                                    ref={fileInputRef}
                                    onChange={handleFileChange}
                                    style={{ display: 'none' }}
                                />
                                <button
                                    className="upload-btn"
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={isUploading}
                                >
                                    <Camera size={20} />
                                    {isUploading ? 'Compressing...' : 'Add Photo'}
                                </button>
                                <div className="image-preview-list">
                                    {images.map((img, i) => (
                                        <div key={i} className="image-preview-item">
                                            <img src={img.url} alt="receipt" />
                                            <button
                                                className="remove-img-btn"
                                                onClick={() => setImages(prev => prev.filter((_, j) => j !== i))}
                                            >
                                                <XCircle size={16} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Added By */}
                        <div className="form-group">
                            <label>Added By</label>
                            <select
                                value={form.addedBy}
                                onChange={e => setF('addedBy', e.target.value)}
                                className="atf-select"
                            >
                                <option value="Owner">Owner</option>
                                <option value="Staff">Staff</option>
                            </select>
                        </div>

                    </div>
                )}

                {/* ── Footer ── */}
                {step === 2 && (
                    <div className="popup-footer">
                        <button className="btn-cancel" onClick={onClose} disabled={isSaving}>
                            Cancel
                        </button>
                        <button
                            className="btn-save"
                            onClick={handleSave}
                            disabled={isSaving || !canSave}
                            style={{ background: canSave ? catColor : undefined }}
                        >
                            <Check size={18} />
                            {isSaving ? 'Saving...' : 'Save Transaction'}
                        </button>
                    </div>
                )}

            </div>
        </div>

        {receiptData && (
            <ReceiptModal
                transaction={receiptData.transaction}
                customer={receiptData.customer}
                onClose={() => { setReceiptData(null); onClose(); }}
            />
        )}
        </>
    );
};

export default AddTransactionFlow;
