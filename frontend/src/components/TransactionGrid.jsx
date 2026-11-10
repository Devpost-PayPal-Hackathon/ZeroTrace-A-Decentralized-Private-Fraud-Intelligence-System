import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry } from "ag-grid-community";
import { useState, useMemo } from "react";

ModuleRegistry.registerModules([AllCommunityModule]);

function ScoreBar({ value }) {
    const color = value > 0.75 ? "#f87171" : value > 0.4 ? "#fbbf24" : "#34d399";
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 56, height: 4, background: "#1e1e3a", borderRadius: 2, flexShrink: 0 }}>
                <div style={{ width: `${value * 100}%`, height: "100%", background: color, borderRadius: 2 }} />
            </div>
            <span style={{ color, fontWeight: 600, fontSize: 12, fontVariantNumeric: "tabular-nums" }}>{value.toFixed(3)}</span>
        </div>
    );
}

function ProofBadge({ value }) {
    const cfg = {
        "on-chain": { label: "on-chain", color: "#34d399", bg: "#34d39915" },
        "proved": { label: "proved", color: "#a5b4fc", bg: "#a5b4fc15" },
        "none": { label: "none", color: "#444", bg: "transparent" },
    };
    const s = cfg[value] || cfg["none"];
    return (
        <span style={{ color: s.color, background: s.bg, fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 4, border: `1px solid ${s.color}30` }}>
            {s.label}
        </span>
    );
}

function ConfBadge({ value }) {
    const cfg = { high: "#f87171", medium: "#fbbf24", low: "#34d399" };
    const color = cfg[value] || "#555";
    return <span style={{ color, fontSize: 12, fontWeight: 500 }}>{value || "—"}</span>;
}

function VerdictCell({ value }) {
    return value
        ? <span style={{ color: "#f87171", fontSize: 11, fontWeight: 700 }}>FRAUD</span>
        : <span style={{ color: "#34d399", fontSize: 11, fontWeight: 600 }}>legit</span>;
}

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const fmtDollars = (p) => {
    const v = parseFloat(p.value);
    return isNaN(v) ? "—" : `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export default function TransactionGrid({ transactions, onSelectTx, selectedId, onRefresh }) {
    const [filter, setFilter] = useState("all");
    const [confidence, setConfidence] = useState("all");
    const [source, setSource] = useState("all");
    const [minAmount, setMinAmount] = useState("");
    const [maxAmount, setMaxAmount] = useState("");
    const [search, setSearch] = useState("");
    const [confirmClear, setConfirmClear] = useState(false);

    const deleteOne = async (txId, e) => {
        e.stopPropagation();
        e.preventDefault();
        await fetch(`${API}/fraud/transactions/${txId}`, { method: "DELETE" });
        onRefresh?.();
    };

    const deleteAll = async () => {
        await fetch(`${API}/fraud/transactions`, { method: "DELETE" });
        setConfirmClear(false);
        onRefresh?.();
    };

    const sources = useMemo(() => {
        const s = new Set(transactions.map(t => t.source).filter(Boolean));
        return ["all", ...s];
    }, [transactions]);

    const filtered = useMemo(() => {
        return transactions.filter(tx => {
            if (filter === "fraud" && !tx.is_fraud) return false;
            if (filter === "legit" && tx.is_fraud) return false;
            if (confidence !== "all" && tx.confidence !== confidence) return false;
            if (source !== "all" && tx.source !== source) return false;
            if (minAmount !== "" && tx.amount < parseFloat(minAmount)) return false;
            if (maxAmount !== "" && tx.amount > parseFloat(maxAmount)) return false;
            if (search && !tx.tx_id.toLowerCase().includes(search.toLowerCase())) return false;
            return true;
        });
    }, [transactions, filter, confidence, source, minAmount, maxAmount, search]);

    const colDefs = [
        {
            field: "tx_id", headerName: "Transaction ID", width: 260, pinned: "left",
            cellRenderer: ({ value }) => (
                <span style={{ fontFamily: "monospace", fontSize: 11, color: "#888" }}>{value}</span>
            )
        },
        {
            field: "is_fraud", headerName: "Verdict", width: 90,
            cellRenderer: ({ value }) => <VerdictCell value={value} />
        },
        {
            field: "fraud_score", headerName: "Risk Score", width: 155,
            cellRenderer: ({ value }) => <ScoreBar value={value} />, sort: "desc"
        },
        {
            field: "amount", headerName: "Amount", width: 120,
            cellStyle: params => ({ color: params.data?.is_fraud ? "#dc143c" : "#90ee90" }),
            valueFormatter: fmtDollars,
        },
        {
            field: "type", headerName: "Type", width: 110,
            cellRenderer: ({ value }) => (
                <span style={{ fontSize: 11, color: "#a5b4fc", fontWeight: 600 }}>{value || "—"}</span>
            )
        },
        {
            field: "oldbalanceOrg", headerName: "Sender Before", width: 130,
            cellStyle: params => ({ color: params.data?.is_fraud ? "#dc143c" : "#90ee90" }),
            valueFormatter: fmtDollars,
        },
        {
            field: "newbalanceOrig", headerName: "Sender After", width: 130,
            cellStyle: params => ({ color: params.data?.is_fraud ? "#dc143c" : "#90ee90" }),
            valueFormatter: fmtDollars,
        },
        {
            field: "oldbalanceDest", headerName: "Receiver Before", width: 140,
            cellStyle: params => ({ color: params.data?.is_fraud ? "#dc143c" : "#90ee90" }),
            valueFormatter: fmtDollars,
        },
        {
            field: "newbalanceDest", headerName: "Receiver After", width: 140,
            cellStyle: params => ({ color: params.data?.is_fraud ? "#dc143c" : "#90ee90" }),
            valueFormatter: fmtDollars,
        },
        {
            field: "confidence", headerName: "Confidence", width: 110,
            cellRenderer: ({ value }) => <ConfBadge value={value} />
        },
        {
            field: "proof_status", headerName: "ZK Proof", width: 110,
            cellRenderer: ({ value }) => <ProofBadge value={value} />
        },
        {
            field: "source", headerName: "Source", width: 100,
            cellRenderer: ({ value }) => <span style={{ fontSize: 11, color: "#777" }}>{value}</span>
        },
        {
            field: "timestamp", headerName: "Time", width: 160,
            cellStyle: params => ({ color: params.data?.is_fraud ? "#dc143c" : "#90ee90", fontSize: 11 }),
            valueFormatter: p => new Date(p.value).toLocaleString()
        },
        {
            headerName: "🗑", width: 60, sortable: false, resizable: false,
            suppressRowClickSelection: true,
            cellRenderer: (params) => (
                <button
                    onClick={e => deleteOne(params.data.tx_id, e)}
                    style={{ background: "none", border: "1px solid #333", color: "#666", borderRadius: 4, padding: "2px 7px", cursor: "pointer", fontSize: 12 }}
                >🗑</button>
            )
        },
    ];

    const btnStyle = (active) => ({
        background: active ? "#1a1a3a" : "none",
        border: `1px solid ${active ? "#6366f140" : "#1e1e3a"}`,
        color: active ? "#a5b4fc" : "#555",
        padding: "4px 12px", borderRadius: 5, fontSize: 12, cursor: "pointer", fontWeight: active ? 600 : 400
    });

    const inputStyle = {
        background: "#0e0e1e", border: "1px solid #1e1e3a", color: "#ccc",
        padding: "4px 10px", borderRadius: 5, fontSize: 12, width: 90, outline: "none"
    };

    const selectStyle = {
        background: "#0e0e1e", border: "1px solid #1e1e3a", color: "#ccc",
        padding: "4px 10px", borderRadius: 5, fontSize: 12, outline: "none", cursor: "pointer"
    };

    const fraudCount = transactions.filter(t => t.is_fraud).length;
    const legitCount = transactions.length - fraudCount;

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 12 }}>
            {/* Toolbar */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 600, fontSize: 14, color: "#fff", marginRight: 4 }}>Transactions</span>
                <span style={{ fontSize: 11, color: "#444", marginRight: 8 }}>{filtered.length} of {transactions.length}</span>

                <button style={btnStyle(filter === "all")} onClick={() => setFilter("all")}>All</button>
                <button style={btnStyle(filter === "fraud")} onClick={() => setFilter("fraud")}>
                    <span style={{ color: "#f87171" }}>●</span> Fraud ({fraudCount})
                </button>
                <button style={btnStyle(filter === "legit")} onClick={() => setFilter("legit")}>
                    <span style={{ color: "#34d399" }}>●</span> Legit ({legitCount})
                </button>

                <div style={{ width: 1, height: 20, background: "#1e1e3a", margin: "0 4px" }} />

                <select value={confidence} onChange={e => setConfidence(e.target.value)} style={selectStyle}>
                    <option value="all">All Confidence</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                </select>

                <select value={source} onChange={e => setSource(e.target.value)} style={selectStyle}>
                    {sources.map(s => <option key={s} value={s}>{s === "all" ? "All Sources" : s}</option>)}
                </select>

                <input style={inputStyle} placeholder="Min $" value={minAmount} onChange={e => setMinAmount(e.target.value)} type="number" />
                <span style={{ color: "#444", fontSize: 12 }}>–</span>
                <input style={inputStyle} placeholder="Max $" value={maxAmount} onChange={e => setMaxAmount(e.target.value)} type="number" />

                <input
                    style={{ ...inputStyle, width: 180 }}
                    placeholder="Search TX ID..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                />

                {(filter !== "all" || confidence !== "all" || source !== "all" || minAmount || maxAmount || search) && (
                    <button
                        onClick={() => { setFilter("all"); setConfidence("all"); setSource("all"); setMinAmount(""); setMaxAmount(""); setSearch(""); }}
                        style={{ background: "none", border: "none", color: "#6366f1", fontSize: 12, cursor: "pointer" }}>
                        Clear filters
                    </button>
                )}

                <div style={{ marginLeft: "auto" }}>
                    {!confirmClear ? (
                        <button onClick={() => setConfirmClear(true)} style={{
                            background: "#2a0a0a", border: "1px solid #dc143c40", color: "#dc143c",
                            padding: "4px 12px", borderRadius: 5, fontSize: 12, cursor: "pointer", fontWeight: 600
                        }}>🗑 Clear All</button>
                    ) : (
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <span style={{ fontSize: 12, color: "#f87171" }}>Sure?</span>
                            <button onClick={deleteAll} style={{
                                background: "#dc143c", border: "none", color: "#fff",
                                padding: "4px 10px", borderRadius: 5, fontSize: 12, cursor: "pointer", fontWeight: 700
                            }}>Yes</button>
                            <button onClick={() => setConfirmClear(false)} style={{
                                background: "none", border: "1px solid #333", color: "#666",
                                padding: "4px 10px", borderRadius: 5, fontSize: 12, cursor: "pointer"
                            }}>No</button>
                        </div>
                    )}
                </div>
            </div>

            {/* Grid */}
            <div className="ag-theme-quartz-dark" style={{ flex: 1, width: "100%", minHeight: 0, height: "100%" }}>
                <AgGridReact
                    rowData={filtered}
                    columnDefs={colDefs}
                    domLayout="normal"
                    rowSelection="single"
                    pagination={true}
                    paginationPageSize={25}
                    paginationPageSizeSelector={[25, 50, 100]}
                    defaultColDef={{ resizable: true, sortable: true }}
                    suppressRowClickSelection={false}
                    onCellClicked={e => { if (e.colDef.headerName !== "🗑") onSelectTx(e.data); }}
                    getRowStyle={params => params.data?.is_fraud
                        ? { background: "#3d0f0f", borderLeft: "3px solid #dc143c" }
                        : { background: "#0d2b1a", borderLeft: "3px solid #90ee90" }}
                    getRowId={params => params.data.tx_id}
                />
            </div>
        </div>
    );
}