import { useState, useRef } from "react";

const API = "http://localhost:8000";

const TYPE_MAP = { CASH_IN: 0, CASH_OUT: 1, DEBIT: 2, PAYMENT: 3, TRANSFER: 4 };

function parseCSV(text) {
    const lines = text.trim().split("\n");
    const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
    const rows = lines.slice(1).map(line => {
        const vals = line.split(",").map(v => v.trim().replace(/^"|"$/g, ""));
        const obj = {};
        headers.forEach((h, i) => { obj[h] = vals[i]; });
        return obj;
    });
    return { headers, rows };
}

function validateHeaders(headers) {
    const required = ["type", "amount", "oldbalanceOrg", "newbalanceOrig", "oldbalanceDest", "newbalanceDest"];
    const missing = required.filter(r => !headers.map(h => h.toLowerCase()).includes(r.toLowerCase()));
    return missing;
}

function buildFeatures(row) {
    const typeRaw = (row.type || row.Type || "PAYMENT").toString().trim().toUpperCase();
    const type_encoded = TYPE_MAP[typeRaw] ?? 3;

    const amount = parseFloat(row.amount || row.Amount || 0);
    const oldbalanceOrg = parseFloat(row.oldbalanceOrg || row.OldbalanceOrg || 0);
    const newbalanceOrig = parseFloat(row.newbalanceOrig || row.NewbalanceOrig || 0);
    const oldbalanceDest = parseFloat(row.oldbalanceDest || row.OldbalanceDest || 0);
    const newbalanceDest = parseFloat(row.newbalanceDest || row.NewbalanceDest || 0);

    const errorBalanceOrig = typeRaw === "CASH_IN"
        ? Math.abs(newbalanceOrig - (oldbalanceOrg + amount))
        : Math.abs(newbalanceOrig - (oldbalanceOrg - amount));

    const errorBalanceDest = (typeRaw === "CASH_OUT" || typeRaw === "PAYMENT" || typeRaw === "DEBIT")
        ? 0
        : typeRaw === "CASH_IN"
            ? Math.abs(newbalanceDest - (oldbalanceDest - amount))
            : Math.abs(newbalanceDest - (oldbalanceDest + amount));
    const isFlaggedFraud = (type_encoded === 1 || type_encoded === 4) && newbalanceOrig === 0 ? 1 : 0;

    return {
        amount,
        type_encoded,
        oldbalanceOrg,
        newbalanceOrig,
        oldbalanceDest,
        newbalanceDest,
        errorBalanceOrig,
        errorBalanceDest,
        isFlaggedFraud,
        display_amount: amount,
        _pre_normalized: false,
    };
}

export default function CSVUpload({ onComplete }) {
    const [status, setStatus] = useState("idle");
    const [results, setResults] = useState([]);
    const [progress, setProgress] = useState({ done: 0, total: 0, fraud: 0 });
    const [error, setError] = useState("");
    const [fileName, setFileName] = useState("");
    const [dragging, setDragging] = useState(false);
    const fileRef = useRef();
    const abortRef = useRef(false);

    const handleFile = async (file) => {
        if (!file || !file.name.endsWith(".csv")) {
            setError("Please upload a .csv file.");
            setStatus("error");
            return;
        }
        setFileName(file.name);
        setStatus("parsing");
        setResults([]);
        setError("");
        abortRef.current = false;

        const text = await file.text();
        const { headers, rows } = parseCSV(text);
        const missing = validateHeaders(headers);

        if (missing.length > 0) {
            setError(`Missing required columns: ${missing.join(", ")}`);
            setStatus("error");
            return;
        }

        setStatus("scoring");
        setProgress({ done: 0, total: rows.length, fraud: 0 });

        const newResults = [];
        let fraudCount = 0;

        for (let i = 0; i < rows.length; i++) {
            if (abortRef.current) break;
            const features = buildFeatures(rows[i]);
            try {
                const resp = await fetch(`${API}/fraud/score`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(features),
                });
                const data = await resp.json();
                if (data.is_fraud) fraudCount++;
                newResults.push({
                    row: i + 1,
                    type: (rows[i].type || rows[i].Type || "—").toUpperCase(),
                    amount: features.amount,
                    fraud_score: data.fraud_score,
                    is_fraud: data.is_fraud,
                    confidence: data.confidence,
                    explanation: data.explanation,
                });
                setResults([...newResults]);
                setProgress({ done: i + 1, total: rows.length, fraud: fraudCount });
            } catch (e) {
                newResults.push({ row: i + 1, amount: features.amount, error: true });
                setResults([...newResults]);
                setProgress(p => ({ ...p, done: i + 1 }));
            }
            if (i % 5 === 0) await new Promise(r => setTimeout(r, 0));
        }

        setStatus("done");
        onComplete?.();
    };

    const reset = () => {
        abortRef.current = true;
        setStatus("idle");
        setResults([]);
        setFileName("");
        setError("");
        setProgress({ done: 0, total: 0, fraud: 0 });
    };

    const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

    return (
        <div style={{ maxWidth: 900, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>
            <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#fff", marginBottom: 4 }}>CSV Fraud Scanner</div>
                <div style={{ fontSize: 13, color: "#555" }}>
                    Upload a CSV with columns:&nbsp;
                    {["type", "amount", "oldbalanceOrg", "newbalanceOrig", "oldbalanceDest", "newbalanceDest"].map(c => (
                        <code key={c} style={{ color: "#a5b4fc", background: "#1a1a3a", padding: "1px 5px", borderRadius: 3, marginRight: 4 }}>{c}</code>
                    ))}
                </div>
            </div>

            {status === "idle" && (
                <div
                    onDragOver={e => { e.preventDefault(); setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
                    onClick={() => fileRef.current.click()}
                    style={{
                        border: `2px dashed ${dragging ? "#6366f1" : "#1e1e3a"}`,
                        borderRadius: 10, padding: "32px 32px", textAlign: "center",
                        cursor: "pointer", transition: "border-color 0.15s",
                        background: dragging ? "#6366f108" : "#0a0a18"
                    }}
                >
                    <div style={{ fontSize: 32, marginBottom: 12 }}>📂</div>
                    <div style={{ fontSize: 14, color: "#ccc", marginBottom: 6 }}>Drop your CSV here or click to browse</div>
                    <div style={{ fontSize: 12, color: "#444" }}>PaySim format — type, amount, balance columns</div>
                    <input ref={fileRef} type="file" accept=".csv" style={{ display: "none" }} onChange={e => handleFile(e.target.files[0])} />
                </div>
            )}

            {status === "parsing" && (
                <div style={{ textAlign: "center", color: "#666", padding: 40 }}>Parsing {fileName}…</div>
            )}

            {(status === "scoring" || status === "done") && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    <div style={{ background: "#0e0e1e", border: "1px solid #1e1e3a", borderRadius: 8, padding: "16px 20px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                            <span style={{ fontSize: 13, color: "#ccc" }}>
                                {status === "done" ? `✓ Done — ${fileName}` : `Scoring ${fileName}…`}
                            </span>
                            <div style={{ display: "flex", gap: 16, fontSize: 12 }}>
                                <span style={{ color: "#555" }}>{progress.done}/{progress.total} rows</span>
                                <span style={{ color: "#f87171" }}>{progress.fraud} fraud</span>
                                {status === "scoring" && (
                                    <button onClick={() => { abortRef.current = true; setStatus("done"); }}
                                        style={{ background: "none", border: "1px solid #333", color: "#666", padding: "1px 8px", borderRadius: 4, cursor: "pointer", fontSize: 11 }}>
                                        Stop
                                    </button>
                                )}
                            </div>
                        </div>
                        <div style={{ height: 4, background: "#1e1e3a", borderRadius: 2 }}>
                            <div style={{ width: `${pct}%`, height: "100%", background: status === "done" ? "#34d399" : "#6366f1", borderRadius: 2, transition: "width 0.2s" }} />
                        </div>
                    </div>

                    {results.length > 0 && (
                        <div style={{ background: "#0e0e1e", border: "1px solid #1e1e3a", borderRadius: 8, overflow: "hidden" }}>
                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                                <thead>
                                    <tr style={{ borderBottom: "1px solid #1e1e3a" }}>
                                        {["Row", "Type", "Amount", "Risk Score", "Verdict", "Confidence", "Explanation"].map(h => (
                                            <th key={h} style={{ padding: "8px 14px", color: "#555", fontWeight: 500, textAlign: "left" }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {results.slice(-50).map((r, i) => (
                                        <tr key={i} style={{ borderBottom: "1px solid #0f0f1e", background: r.is_fraud ? "#2a0a0a" : "#0a1a0f" }}>
                                            <td style={{ padding: "7px 14px", color: "#555" }}>{r.row}</td>
                                            <td style={{ padding: "7px 14px", color: "#777" }}>{r.type || "—"}</td>
                                            <td style={{ padding: "7px 14px", color: r.is_fraud ? "#dc143c" : "#90ee90" }}>${(r.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                            <td style={{ padding: "7px 14px" }}>
                                                {r.error ? <span style={{ color: "#f87171" }}>Error</span> : (
                                                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                                        <div style={{ width: 40, height: 3, background: "#1e1e3a", borderRadius: 2 }}>
                                                            <div style={{ width: `${(r.fraud_score || 0) * 100}%`, height: "100%", background: r.fraud_score > 0.75 ? "#f87171" : r.fraud_score > 0.4 ? "#fbbf24" : "#34d399", borderRadius: 2 }} />
                                                        </div>
                                                        <span style={{ color: r.fraud_score > 0.75 ? "#f87171" : r.fraud_score > 0.4 ? "#fbbf24" : "#34d399", fontVariantNumeric: "tabular-nums" }}>
                                                            {(r.fraud_score || 0).toFixed(3)}
                                                        </span>
                                                    </div>
                                                )}
                                            </td>
                                            <td style={{ padding: "7px 14px" }}>
                                                {r.is_fraud
                                                    ? <span style={{ color: "#dc143c", fontWeight: 700 }}>FRAUD</span>
                                                    : <span style={{ color: "#90ee90" }}>legit</span>}
                                            </td>
                                            <td style={{ padding: "7px 14px", color: "#777" }}>{r.confidence || "—"}</td>
                                            <td style={{ padding: "7px 14px", color: "#666", maxWidth: 240, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.explanation || "—"}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {results.length > 50 && (
                                <div style={{ padding: "8px 14px", fontSize: 11, color: "#444", borderTop: "1px solid #1e1e3a" }}>
                                    Showing last 50 of {results.length} rows — all results saved to database
                                </div>
                            )}
                        </div>
                    )}

                    {status === "done" && (
                        <button onClick={reset} style={{
                            alignSelf: "flex-start", background: "#1a1a3a", border: "1px solid #6366f130",
                            color: "#a5b4fc", padding: "8px 20px", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600
                        }}>
                            Upload another CSV
                        </button>
                    )}
                </div>
            )}

            {status === "error" && (
                <div style={{ background: "#1a0a0a", border: "1px solid #f8717130", borderRadius: 8, padding: "16px 20px" }}>
                    <div style={{ color: "#f87171", fontSize: 13, marginBottom: 10 }}>{error}</div>
                    <button onClick={reset} style={{ background: "none", border: "1px solid #333", color: "#888", padding: "5px 14px", borderRadius: 5, cursor: "pointer", fontSize: 12 }}>
                        Try again
                    </button>
                </div>
            )}
        </div>
    );
}