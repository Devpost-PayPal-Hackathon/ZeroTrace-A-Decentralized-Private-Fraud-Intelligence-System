export default function StatsBar({ stats }) {
    const cards = [
        { label: "Total Transactions", value: stats.total_transactions.toLocaleString(), color: "#a5b4fc", icon: "⬡" },
        { label: "Flagged Fraud", value: stats.flagged.toLocaleString(), color: "#f87171", icon: "⚑" },
        { label: "Fraud Rate", value: `${stats.fraud_rate.toFixed(2)}%`, color: "#fbbf24", icon: "%" },
        { label: "ZK Proofs On-Chain", value: stats.proofs_submitted.toLocaleString(), color: "#34d399", icon: "✦" },
    ];

    return (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", borderBottom: "1px solid #1e1e3a" }}>
            {cards.map((c, i) => (
                <div key={c.label} style={{
                    padding: "10px 24px",
                    background: "#0a0a18",
                    borderRight: i < 3 ? "1px solid #1e1e3a" : "none",
                    display: "flex", alignItems: "center", gap: 14
                }}>
                    <span style={{ fontSize: 20, color: c.color, opacity: 0.7 }}>{c.icon}</span>
                    <div>
                        <div style={{ fontSize: 20, fontWeight: 700, color: c.color, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>{c.value}</div>
                        <div style={{ fontSize: 11, color: "#555", marginTop: 3, letterSpacing: "0.02em" }}>{c.label}</div>
                    </div>
                </div>
            ))}
        </div>
    );
}