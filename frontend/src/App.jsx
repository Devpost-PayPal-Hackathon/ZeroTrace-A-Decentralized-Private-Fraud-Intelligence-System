import { useState, useEffect, useCallback } from "react";
import { PayPalScriptProvider, PayPalButtons } from "@paypal/react-paypal-js";
import TransactionGrid from "./components/TransactionGrid";
import FraudExplainer from "./components/FraudExplainer";
import StatsBar from "./components/StatsBar";
import ChartsPanel from "./components/ChartsPanel";
import CSVUpload from "./components/CSVUpload";
import "./App.css";

const PAYPAL_CLIENT_ID = import.meta.env.VITE_PAYPAL_CLIENT_ID || "";

const TYPE_OPTIONS = [
  { value: 0, label: "CASH_IN" },
  { value: 1, label: "CASH_OUT" },
  { value: 2, label: "DEBIT" },
  { value: 3, label: "PAYMENT" },
  { value: 4, label: "TRANSFER" },
];

export default function App() {
  const [selectedTx, setSelectedTx] = useState(null);
  const [activeTab, setActiveTab] = useState("monitor");
  const [stats, setStats] = useState({ total_transactions: 0, flagged: 0, fraud_rate: 0.0, proofs_submitted: 0 });
  const [transactions, setTransactions] = useState([]);
  const [polling, setPolling] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [paypalResult, setPaypalResult] = useState(null);
  const [paypalError, setPaypalError] = useState(null);
  const [isSuspicious, setIsSuspicious] = useState(false);
  const [sandboxCap, setSandboxCap] = useState(false);
  const [capError, setCapError] = useState(false);

  // The 6 visible columns — raw display values (not normalized)
  const [payRow, setPayRow] = useState({
    type_encoded: 3,       // dropdown
    amount: 25,            // real dollars
    oldbalanceOrg: 0,
    newbalanceOrig: 0,
    oldbalanceDest: 0,
    newbalanceDest: 0,
  });

  // Hidden fields — computed or preset
  const [hiddenFields, setHiddenFields] = useState({
    errorBalanceOrig: 0,
    errorBalanceDest: 0,
    isFlaggedFraud: 0,
    // normalized versions for backend
    _normalized: null,
  });

  const fetchAll = useCallback(() => {
    fetch("http://localhost:8000/stats").then(r => r.json()).then(setStats).catch(console.error);
    fetch("http://localhost:8000/fraud/transactions?page=1&page_size=10000")
      .then(r => r.json())
      .then(data => {
        const rows = (data.transactions || []).map(tx => ({
          tx_id: tx.id,
          amount: tx.amount ?? 0,
          timestamp: tx.created_at,
          fraud_score: tx.fraud_score,
          is_fraud: tx.is_fraud,
          confidence: tx.confidence,
          risk_factors: tx.risk_factors || [],
          explanation: tx.explanation,
          source: tx.source,
          proof_status: tx.zk_proof ? (tx.zk_proof.onchain_tx_hash ? "on-chain" : "proved") : "none",
          zk_proof: tx.zk_proof ?? null,
          type: tx.type,
          oldbalanceOrg: tx.oldbalanceOrg,
          newbalanceOrig: tx.newbalanceOrig,
          oldbalanceDest: tx.oldbalanceDest,
          newbalanceDest: tx.newbalanceDest,
        }));
        setTransactions(rows);
        setLastUpdated(new Date());
      }).catch(console.error);
  }, []);

  useEffect(() => {
    fetchAll();
    if (!polling) return;
    const interval = setInterval(fetchAll, 3000);
    return () => clearInterval(interval);
  }, [fetchAll, polling]);

  const round2 = (v) => Math.round(v * 100) / 100;

  const handleFillNormal = async () => {
    const capParam = sandboxCap ? `&cap=9999` : '';
    const res = await fetch(`http://localhost:8000/paypal/presets?t=${Date.now()}${capParam}`);
    const data = await res.json();
    const p = data.normal;
    const oldOrg = p.display_oldbalanceOrg ?? 0;
    const oldDest = p.display_oldbalanceDest ?? 0;
    const amt = p.display_amount ?? 25;
    setIsSuspicious(false); // normal mode — auto-calc enabled
    setPayRow({
      type_encoded: p.type_encoded ?? 3,
      amount: amt,
      oldbalanceOrg: oldOrg,
      newbalanceOrig: round2(Math.max(oldOrg - amt, 0)), // correct math on load
      oldbalanceDest: oldDest,
      newbalanceDest: round2(oldDest + amt),             // correct math on load
    });
    setHiddenFields({
      errorBalanceOrig: p.errorBalanceOrig ?? 0,
      errorBalanceDest: p.errorBalanceDest ?? 0,
      isFlaggedFraud: p.isFlaggedFraud ?? 0,
      _normalized: p,
    });
  };

  const handleFillSuspicious = async () => {
    const capParam = sandboxCap ? `&cap=9999` : '';
    const res = await fetch(`http://localhost:8000/paypal/presets?t=${Date.now()}${capParam}`);
    const data = await res.json();
    const p = data.suspicious;
    setIsSuspicious(true); // suspicious mode — auto-calc disabled, balances frozen
    setPayRow({
      type_encoded: p.type_encoded ?? 1,
      amount: p.display_amount ?? 4000,
      oldbalanceOrg: p.display_oldbalanceOrg ?? 0,
      newbalanceOrig: p.display_newbalanceOrig ?? 0,   // preset fills 0 (drained)
      oldbalanceDest: p.display_oldbalanceDest ?? 0,
      newbalanceDest: p.display_newbalanceDest ?? 0,   // preset fills 0 (got nothing)
    });
    setHiddenFields({
      errorBalanceOrig: p.errorBalanceOrig ?? 0,
      errorBalanceDest: p.errorBalanceDest ?? 0,
      isFlaggedFraud: p.isFlaggedFraud ?? 0,
      _normalized: p,
    });
  };

  // Build the payload for backend — use raw display values, backend normalizes
  const buildCapturePayload = () => {
    return {
      type_encoded: payRow.type_encoded,
      amount: payRow.amount,
      display_amount: payRow.amount,
      oldbalanceOrg: payRow.oldbalanceOrg,
      newbalanceOrig: payRow.newbalanceOrig,
      oldbalanceDest: payRow.oldbalanceDest,
      newbalanceDest: payRow.newbalanceDest,
      errorBalanceOrig: Math.abs(payRow.newbalanceOrig - (payRow.oldbalanceOrg - payRow.amount)),
      errorBalanceDest: Math.abs(payRow.newbalanceDest - (payRow.oldbalanceDest + payRow.amount)),
      isFlaggedFraud: hiddenFields.isFlaggedFraud,
      display_oldbalanceOrg: payRow.oldbalanceOrg,
      display_newbalanceOrig: payRow.newbalanceOrig,
      display_oldbalanceDest: payRow.oldbalanceDest,
      display_newbalanceDest: payRow.newbalanceDest,
      pre_normalized: false,
    };
  };

  const updatePayRow = (key, val) => {
    if (key === 'amount' && sandboxCap && val > 9999) {
      setCapError(true);
      return;
    }
    setCapError(false);
    setPayRow(r => {
      const updated = { ...r, [key]: val };

      // Only auto-calc for normal (legit) preset — suspicious balances stay frozen
      if (!isSuspicious) {
        if (key === 'amount' || key === 'oldbalanceOrg') {
          updated.newbalanceOrig = round2(Math.max(updated.oldbalanceOrg - updated.amount, 0));
        }
        if (key === 'amount' || key === 'oldbalanceDest') {
          updated.newbalanceDest = round2(updated.oldbalanceDest + updated.amount);
        }
      }

      const errOrig = Math.abs(updated.newbalanceOrig - (updated.oldbalanceOrg - updated.amount));
      const errDest = Math.abs(updated.newbalanceDest - (updated.oldbalanceDest + updated.amount));
      setHiddenFields(h => ({
        ...h,
        errorBalanceOrig: errOrig,
        errorBalanceDest: errDest,
      }));
      return updated;
    });
  };

  const tabs = [
    { id: "monitor", label: "Live Monitor" },
    { id: "analytics", label: "Analytics" },
    { id: "pay", label: "💳 Pay" },
    { id: "csv", label: "📁 CSV Scan" },
  ];

  const colStyle = {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  };

  const labelStyle = {
    fontSize: 10,
    color: "#666",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    whiteSpace: "nowrap",
  };

  const inputStyle = {
    padding: "8px 10px",
    background: "#0a0a1a",
    border: "1px solid #1e1e3a",
    color: "#fff",
    borderRadius: 6,
    fontSize: 13,
    width: "100%",
    boxSizing: "border-box",
  };

  const selectStyle = {
    ...inputStyle,
    cursor: "pointer",
  };

  return (
    <PayPalScriptProvider options={{ clientId: PAYPAL_CLIENT_ID, currency: "USD", locale: "en_US" }}>
      <div style={{ height: "100svh", background: "#080812", color: "#e8e8f0", fontFamily: "'Inter', system-ui, sans-serif", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Header */}
        <div style={{ background: "#0e0e1e", borderBottom: "1px solid #1e1e3a", padding: "0 32px", display: "flex", alignItems: "center", gap: 20, height: 56 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <circle cx="11" cy="11" r="10" stroke="#6366f1" strokeWidth="1.5" />
              <path d="M7 11l3 3 5-5" stroke="#6366f1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span style={{ fontSize: 16, fontWeight: 700, color: "#fff", letterSpacing: "-0.3px" }}>ZeroTrace</span>
            <span style={{ fontSize: 11, color: "#6366f1", fontWeight: 500, background: "#6366f120", padding: "2px 8px", borderRadius: 4 }}>v8</span>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 2, marginLeft: 24 }}>
            {tabs.map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
                background: activeTab === t.id ? "#1a1a3a" : "none",
                border: "none", color: activeTab === t.id ? "#a5b4fc" : "#666",
                padding: "6px 16px", borderRadius: 6, fontSize: 13, cursor: "pointer",
                fontWeight: activeTab === t.id ? 600 : 400, transition: "all 0.15s"
              }}>{t.label}</button>
            ))}
          </div>

          {/* Right side */}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
            {lastUpdated && (
              <span style={{ fontSize: 11, color: "#444" }}>
                Updated {lastUpdated.toLocaleTimeString()}
              </span>
            )}
            <button onClick={() => setPolling(p => !p)} style={{
              display: "flex", alignItems: "center", gap: 6,
              background: polling ? "#0a2a1a" : "#1a1a2a",
              border: `1px solid ${polling ? "#06d6a060" : "#333"}`,
              color: polling ? "#06d6a0" : "#666",
              padding: "5px 12px", borderRadius: 6, fontSize: 12, cursor: "pointer", fontWeight: 600
            }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: polling ? "#06d6a0" : "#444", display: "inline-block", boxShadow: polling ? "0 0 6px #06d6a0" : "none" }} />
              {polling ? "LIVE" : "PAUSED"}
            </button>
          </div>
        </div>

        <StatsBar stats={stats} />

        {/* Content */}
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "row", minHeight: 0 }}>
          <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", minWidth: 0 }}>
          {activeTab === "monitor" && (
            <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
              <div style={{ flex: 1, padding: "20px 24px", overflow: "hidden", display: "flex", flexDirection: "column", minWidth: 0 }}>
                <TransactionGrid transactions={transactions} onSelectTx={setSelectedTx} selectedId={selectedTx?.tx_id} onRefresh={fetchAll} />
              </div>
            </div>
          )}

          {activeTab === "analytics" && (
            <div style={{ flex: 1, overflow: "hidden", padding: "16px", minHeight: 0, display: "flex", flexDirection: "column" }}>
              <ChartsPanel transactions={transactions} stats={stats} />
            </div>
          )}

          {activeTab === "pay" && (
            <div style={{ flex: 1, overflowY: "auto", padding: "24px 32px", display: "flex", justifyContent: "center", minHeight: 0 }}>
              <div style={{ width: "100%", maxWidth: 900, background: "#0e0e1e", border: "1px solid #1e1e3a", borderRadius: 12, padding: "20px 28px" }}>
                <h2 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 700, color: "#fff" }}>Test Payment</h2>
                <p style={{ margin: "0 0 16px", fontSize: 12, color: "#666" }}>
                  Sandbox payment — scored in real-time by ZeroTrace using real PaySim fraud patterns
                </p>

                {!paypalResult ? (
                  <>
                    {/* Preset buttons */}
                    <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
                      <button
                        onClick={handleFillNormal}
                        style={{ flex: 1, padding: "10px", background: "#0a2a1a", border: "1px solid #06d6a040", color: "#06d6a0", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 }}
                      >
                        🟢 Fill Normal
                      </button>
                      <button
                        onClick={handleFillSuspicious}
                        style={{ flex: 1, padding: "10px", background: "#2a0a0a", border: "1px solid #ff4d4d40", color: "#ff4d4d", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 }}
                      >
                        🔴 Fill Suspicious
                      </button>
                    </div>

                    {/* Sandbox cap toggle */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                      <button
                        onClick={() => { setSandboxCap(c => !c); setCapError(false); }}
                        style={{
                          padding: "5px 12px",
                          background: sandboxCap ? "#1a1a0a" : "#1a1a2a",
                          border: `1px solid ${sandboxCap ? "#f5a62360" : "#333"}`,
                          color: sandboxCap ? "#f5a623" : "#555",
                          borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600,
                        }}
                      >
                        {sandboxCap ? "🔒 Sandbox Cap ON ($9,999)" : "🔓 Sandbox Cap OFF"}
                      </button>
                      <span
                        title="Enable this cap if using PayPal sandbox (10k limit) — amounts above $9,999 will fail in sandbox"
                        style={{ width: 16, height: 16, borderRadius: "50%", background: "#1e1e3a", color: "#6366f1", fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center", cursor: "default", fontWeight: 700, flexShrink: 0 }}
                      >i</span>
                    </div>

                    {/* 1 row × 6 columns table */}
                    <div style={{
                      display: "grid",
                      gridTemplateColumns: "1.4fr 1fr 1fr 1fr 1fr 1fr",
                      gap: 12,
                      marginBottom: 16,
                    }}>
                      {/* type */}
                      <div style={colStyle}>
                        <span style={labelStyle}>Type</span>
                        <select
                          value={payRow.type_encoded}
                          onChange={e => updatePayRow("type_encoded", parseInt(e.target.value))}
                          style={selectStyle}
                        >
                          {TYPE_OPTIONS.map(o => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </div>

                      {/* amount */}
                      <div style={colStyle}>
                        <span style={labelStyle}>Amount ($)</span>
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={payRow.amount}
                          onChange={e => updatePayRow("amount", parseFloat(e.target.value) || 0)}
                          style={{ ...inputStyle, border: capError ? "1px solid #ff4d4d" : inputStyle.border }}
                        />
                        {capError && <span style={{ fontSize: 10, color: "#ff4d4d" }}>Exceeds $9,999 sandbox cap</span>}
                      </div>

                      {/* oldbalanceOrg */}
                      <div style={colStyle}>
                        <span style={labelStyle}>Sender Before</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={payRow.oldbalanceOrg}
                          onChange={e => updatePayRow("oldbalanceOrg", parseFloat(e.target.value) || 0)}
                          style={inputStyle}
                        />
                      </div>

                      {/* newbalanceOrig */}
                      <div style={colStyle}>
                        <span style={labelStyle}>Sender After</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={payRow.newbalanceOrig}
                          onChange={e => updatePayRow("newbalanceOrig", parseFloat(e.target.value) || 0)}
                          style={inputStyle}
                        />
                      </div>

                      {/* oldbalanceDest */}
                      <div style={colStyle}>
                        <span style={labelStyle}>Receiver Before</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={payRow.oldbalanceDest}
                          onChange={e => updatePayRow("oldbalanceDest", parseFloat(e.target.value) || 0)}
                          style={inputStyle}
                        />
                      </div>

                      {/* newbalanceDest */}
                      <div style={colStyle}>
                        <span style={labelStyle}>Receiver After</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={payRow.newbalanceDest}
                          onChange={e => updatePayRow("newbalanceDest", parseFloat(e.target.value) || 0)}
                          style={inputStyle}
                        />
                      </div>
                    </div>

                    {/* PayPal button */}
                    <div style={{ maxWidth: 400, margin: "0 auto" }}>
                      <PayPalButtons
                        style={{ layout: "vertical", color: "blue", shape: "rect", label: "pay" }}
                        createOrder={() =>
                          fetch("http://localhost:8000/paypal/create-order", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ amount: payRow.amount, currency: "USD" }),
                          })
                            .then(r => r.json())
                            .then(d => d.order_id)
                        }
                        onApprove={(data) => {
                          const payload = buildCapturePayload();
                          console.log("CAPTURE PAYLOAD:", payload);
                          return fetch(`http://localhost:8000/paypal/capture-order/${data.orderID}`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(payload),
                          })
                            .then(r => r.json())
                            .then(result => {
                              setPaypalResult(result);
                              fetchAll();
                            });
                        }}
                        onError={(err) => {
                          console.error("PayPal error", err);
                          setPaypalError("Payment failed — check console");
                        }}
                      />
                    </div>
                  </>
                ) : (
                  <div style={{ maxWidth: 480, margin: "0 auto" }}>
                    <div style={{
                      padding: 20, borderRadius: 8,
                      background: paypalResult.is_fraud ? "#1a0a0a" : "#0a1a0a",
                      border: `1px solid ${paypalResult.is_fraud ? "#ff4d4d40" : "#06d6a040"}`,
                      marginBottom: 16
                    }}>
                      <div style={{ fontSize: 24, fontWeight: 800, color: paypalResult.is_fraud ? "#ff4d4d" : "#06d6a0" }}>
                        {paypalResult.is_fraud ? "⚠️ FRAUD DETECTED" : "✅ LEGITIMATE"}
                      </div>
                      <div style={{ marginTop: 12, fontSize: 13, color: "#aaa", lineHeight: 1.8 }}>
                        <div>Amount: <strong style={{ color: "#fff" }}>${payRow.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
                        <div>Score: <strong style={{ color: "#fff" }}>{(paypalResult.fraud_score * 100).toFixed(1)}%</strong></div>
                        <div>Confidence: <strong style={{ color: "#fff" }}>{paypalResult.confidence}</strong></div>
                        <div>TX: <strong style={{ color: "#6366f1", fontSize: 11 }}>{paypalResult.transaction_id}</strong></div>
                        {paypalResult.explanation && (
                          <div style={{ marginTop: 8, color: "#888" }}>{paypalResult.explanation}</div>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => { setPaypalResult(null); setPaypalError(null); }}
                      style={{ width: "100%", padding: "10px", background: "#1a1a3a", border: "1px solid #333", color: "#a5b4fc", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 }}
                    >
                      Pay Again
                    </button>
                  </div>
                )}

                {paypalError && (
                  <div style={{ marginTop: 12, color: "#ff4d4d", fontSize: 13, textAlign: "center" }}>{paypalError}</div>
                )}
              </div>
            </div>
          )}

          {activeTab === "csv" && (
            <div style={{ flex: 1, overflowY: "auto", padding: "24px 40px", minHeight: 0 }}>
              <CSVUpload onComplete={fetchAll} />
            </div>
          )}
          </div>
          {selectedTx && activeTab === "monitor" && (
            <div className="fraud-explainer" style={{ width: "25%", minWidth: 320, maxWidth: 480, background: "#0e0e1e", borderLeft: "1px solid #1e1e3a", borderTop: "1px solid #1e1e3a", overflowY: "scroll", flexShrink: 0 }}>
              <FraudExplainer tx={selectedTx} onClose={() => setSelectedTx(null)} />
            </div>
          )}
        </div>
      </div>
    </PayPalScriptProvider>
  );
}