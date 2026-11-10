import { useMemo } from "react";
import {
    AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from "recharts";

function Card({ title, children, style = {} }) {
    return (
        <div style={{ background: "#0e0e1e", border: "1px solid #1e1e3a", borderRadius: 10, padding: "14px 20px", display: "flex", flexDirection: "column", ...style }}>
            <div style={{ fontSize: 12, color: "#555", fontWeight: 600, letterSpacing: "0.04em", marginBottom: 10, flexShrink: 0 }}>{title}</div>
            <div style={{ flex: 1, minHeight: 0 }}>
                {children}
            </div>
        </div>
    );
}

const tooltipStyle = { background: "#0e0e1e", border: "1px solid #1e1e3a", borderRadius: 6, fontSize: 12, color: "#ccc" };

export default function ChartsPanel({ transactions, stats }) {
    const timeData = useMemo(() => {
        if (!transactions.length) return [];
        const buckets = {};
        transactions.forEach(tx => {
            const d = new Date(tx.timestamp);
            const key = `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:00`;
            if (!buckets[key]) buckets[key] = { time: key, fraud: 0, legit: 0 };
            tx.is_fraud ? buckets[key].fraud++ : buckets[key].legit++;
        });
        return Object.values(buckets).slice(-24);
    }, [transactions]);

    const histData = useMemo(() => {
        const buckets = Array.from({ length: 10 }, (_, i) => ({
            range: `${(i * 10).toString().padStart(2, "0")}–${((i + 1) * 10).toString().padStart(2, "0")}`,
            count: 0,
            fraud: 0,
        }));
        transactions.forEach(tx => {
            const idx = Math.min(Math.floor(tx.fraud_score * 10), 9);
            buckets[idx].count++;
            if (tx.is_fraud) buckets[idx].fraud++;
        });
        return buckets;
    }, [transactions]);

    const pieData = [
        { name: "Legit", value: transactions.length - transactions.filter(t => t.is_fraud).length },
        { name: "Fraud", value: transactions.filter(t => t.is_fraud).length },
    ];

    const confData = useMemo(() => {
        const c = { high: 0, medium: 0, low: 0 };
        transactions.forEach(tx => { if (tx.confidence && c[tx.confidence] !== undefined) c[tx.confidence]++; });
        return Object.entries(c).map(([name, value]) => ({ name, value }));
    }, [transactions]);

    if (!transactions.length) {
        return (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#444", fontSize: 14 }}>
                No transaction data yet — run the seed script or submit a transaction.
            </div>
        );
    }

    return (
        <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gridTemplateRows: "1fr 1fr",
            gap: 12,
            height: "100%",
        }}>
            {/* Fraud over time — full width top row */}
            <Card title="Transactions over time" style={{ gridColumn: "1 / -1" }}>
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={timeData}>
                        <defs>
                            <linearGradient id="gFraud" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#f87171" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#f87171" stopOpacity={0} />
                            </linearGradient>
                            <linearGradient id="gLegit" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#34d399" stopOpacity={0.2} />
                                <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e1e3a" />
                        <XAxis dataKey="time" tick={{ fill: "#444", fontSize: 10 }} tickLine={false} />
                        <YAxis tick={{ fill: "#444", fontSize: 10 }} tickLine={false} axisLine={false} />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Legend wrapperStyle={{ fontSize: 12, color: "#777" }} />
                        <Area type="monotone" dataKey="legit" stroke="#34d399" fill="url(#gLegit)" strokeWidth={1.5} dot={false} />
                        <Area type="monotone" dataKey="fraud" stroke="#f87171" fill="url(#gFraud)" strokeWidth={1.5} dot={false} />
                    </AreaChart>
                </ResponsiveContainer>
            </Card>

            {/* Score distribution */}
            <Card title="Fraud score distribution">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={histData} barSize={16}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e1e3a" vertical={false} />
                        <XAxis dataKey="range" tick={{ fill: "#444", fontSize: 10 }} tickLine={false} />
                        <YAxis tick={{ fill: "#444", fontSize: 10 }} tickLine={false} axisLine={false} />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Bar dataKey="count" fill="#6366f1" opacity={0.8} radius={[3, 3, 0, 0]}>
                            {histData.map((entry, i) => (
                                <Cell key={i} fill={i >= 7 ? "#f87171" : i >= 4 ? "#fbbf24" : "#34d399"} />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </Card>

            {/* Pie */}
            <Card title="Fraud vs Legit split">
                <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", height: "100%", gap: 16 }}>
                    <ResponsiveContainer width="60%" height="100%">
                        <PieChart>
                            <Pie data={pieData} cx="50%" cy="50%" innerRadius="40%" outerRadius="70%" paddingAngle={3} dataKey="value">
                                <Cell fill="#34d399" />
                                <Cell fill="#f87171" />
                            </Pie>
                            <Tooltip contentStyle={tooltipStyle} />
                        </PieChart>
                    </ResponsiveContainer>
                    <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 20, flexShrink: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#34d399", flexShrink: 0 }} />
                            <div>
                                <div style={{ fontSize: 20, fontWeight: 700, color: "#34d399", lineHeight: 1 }}>{pieData[0].value.toLocaleString()}</div>
                                <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>Legit</div>
                            </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#f87171", flexShrink: 0 }} />
                            <div>
                                <div style={{ fontSize: 20, fontWeight: 700, color: "#f87171", lineHeight: 1 }}>{pieData[1].value.toLocaleString()}</div>
                                <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>Fraud</div>
                            </div>
                        </div>
                    </div>
                </div>
            </Card>
        </div>
    );
}
