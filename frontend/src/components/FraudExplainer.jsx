export default function FraudExplainer({ tx, onClose }) {
    const score = tx.fraud_score;
    const isHigh = score > 0.75;
    const isMed = score > 0.4;
    const color = isHigh ? "#f87171" : isMed ? "#fbbf24" : "#34d399";
    const verdict = isHigh ? "High Risk" : isMed ? "Medium Risk" : "Low Risk";

    const row = (label, value, mono = false) => (
        <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "7px 0", borderBottom: "1px solid #12122a" }}>
            <span style={{ fontSize: 11, color: "#555", flexShrink: 0 }}>{label}</span>
            <span style={{ fontSize: 12, color: "#ccc", fontWeight: 500, textAlign: "right", maxWidth: 220, wordBreak: "break-all", fontFamily: mono ? "monospace" : "inherit" }}>{value}</span>
        </div>
    );

    return (
        <div className="fraud-explainer" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 600, fontSize: 13, color: "#fff" }}>Detail</span>
                <button onClick={onClose} style={{ background: "#1e1e3a", border: "none", color: "#888", width: 28, height: 28, borderRadius: 6, cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
            </div>

            {/* Score */}
            <div style={{ background: "#0a0a18", border: `1px solid ${color}30`, borderRadius: 8, padding: "16px 18px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
                    <div>
                        <div style={{ fontSize: 11, color: "#555", marginBottom: 6 }}>Fraud probability</div>
                        <div style={{ fontSize: 36, fontWeight: 800, color, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                            {(score * 100).toFixed(1)}<span style={{ fontSize: 18 }}>%</span>
                        </div>
                        <div style={{ fontSize: 12, color, marginTop: 4, fontWeight: 500 }}>{verdict}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 11, color: "#555", marginBottom: 4 }}>Confidence</div>
                        <div style={{ fontSize: 13, color: "#ccc", fontWeight: 600 }}>{tx.confidence || "—"}</div>
                    </div>
                </div>
                {/* Score bar */}
                <div style={{ marginTop: 14, height: 4, background: "#1e1e3a", borderRadius: 2 }}>
                    <div style={{ width: `${score * 100}%`, height: "100%", background: color, borderRadius: 2, transition: "width 0.3s" }} />
                </div>
            </div>

            {/* Transaction details */}
            <div style={{ background: "#0a0a18", borderRadius: 8, padding: "12px 16px" }}>
                <div style={{ fontSize: 11, color: "#444", marginBottom: 4, fontWeight: 600, letterSpacing: "0.05em" }}>Transaction</div>
                {row("ID", tx.tx_id, true)}
                {row("Amount", `$${parseFloat(tx.amount ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`)}
                {row("Source", tx.source || "—")}
                {row("Time", new Date(tx.timestamp).toLocaleString())}
            </div>

            {/* Risk factors */}
            {tx.risk_factors?.length > 0 && (
                <div style={{ background: "#0a0a18", borderRadius: 8, padding: "12px 16px" }}>
                    <div style={{ fontSize: 11, color: "#444", marginBottom: 10, fontWeight: 600, letterSpacing: "0.05em" }}>Risk Factors</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {tx.risk_factors.map(f => (
                            <span key={f} style={{ background: "#f8717115", color: "#f87171", fontSize: 11, padding: "3px 10px", borderRadius: 4, border: "1px solid #f8717130" }}>
                                {f}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* Explanation */}
            <div style={{ background: "#0a0a18", borderRadius: 8, padding: "12px 16px" }}>
                <div style={{ fontSize: 11, color: "#444", marginBottom: 8, fontWeight: 600, letterSpacing: "0.05em" }}>AI Explanation</div>
                <p style={{ fontSize: 13, color: "#aaa", lineHeight: 1.65, margin: 0 }}>{tx.explanation}</p>
            </div>

            {/* ZK Proof */}
            <div style={{ background: "#0a0a18", borderRadius: 8, padding: "12px 16px" }}>
                <div style={{ fontSize: 11, color: "#444", marginBottom: 8, fontWeight: 600, letterSpacing: "0.05em" }}>ZK Proof</div>
                {tx.proof_status === "on-chain" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <span style={{ color: "#34d399", fontSize: 13, fontWeight: 600 }}>✓ Verified on-chain</span>
                        {tx.zk_proof?.onchain_tx_hash && row("TX Hash", tx.zk_proof.onchain_tx_hash, true)}
                        {tx.zk_proof?.onchain_block && row("Block", `#${tx.zk_proof.onchain_block}`)}

                        {/* Public signals */}
                        {tx.zk_proof?.public_signals?.length > 0 && (
                            <div style={{ marginTop: 8 }}>
                                <div style={{ fontSize: 11, color: "#555", marginBottom: 6 }}>Public Signals</div>
                                {tx.zk_proof.public_signals.map((sig, i) => (
                                    <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #12122a" }}>
                                        <span style={{ fontSize: 11, color: "#555" }}>
                                            {i === 0 ? "Verdict (1=fraud)" : i === 1 ? "Threshold (75 = 0.75)" : `signal[${i}]`}
                                        </span>
                                        <span style={{ fontSize: 11, color: "#a5b4fc", fontFamily: "monospace" }}>{sig}</span>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Groth16 proof components */}
                        {tx.zk_proof?.proof && (
                            <div style={{ marginTop: 8 }}>
                                <div style={{ fontSize: 11, color: "#555", marginBottom: 6 }}>Groth16 Proof</div>
                                {[
                                    ["π_a", tx.zk_proof.proof.pi_a],
                                    ["π_b (0)", tx.zk_proof.proof.pi_b?.[0]],
                                    ["π_b (1)", tx.zk_proof.proof.pi_b?.[1]],
                                    ["π_c", tx.zk_proof.proof.pi_c],
                                ].map(([label, val]) => val ? (
                                    <div key={label} style={{ marginBottom: 6 }}>
                                        <div style={{ fontSize: 10, color: "#555", marginBottom: 2 }}>{label}</div>
                                        <div style={{ fontSize: 10, color: "#6366f1", fontFamily: "monospace", wordBreak: "break-all", lineHeight: 1.5, background: "#0d0d20", padding: "4px 8px", borderRadius: 4 }}>
                                            [{val.map((v, i) => <span key={i}>{i > 0 ? ", " : ""}{v.slice(0, 12)}…</span>)}]
                                        </div>
                                    </div>
                                ) : null)}
                            </div>
                        )}
                    </div>
                )}
                {tx.proof_status === "proved" && (
                    <span style={{ color: "#a5b4fc", fontSize: 13 }}>Proof ready, submitting…</span>
                )}
                {tx.proof_status === "none" && (
                    <span style={{ color: "#444", fontSize: 13 }}>Not proved — score below threshold</span>
                )}
            </div>
        </div>
    );
}