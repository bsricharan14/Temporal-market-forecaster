interface BenchmarkStats {
    median_ms?: number | null;
    rows?: number;
}

type BenchmarkCase = {
    id: string;
    label: string;
    plain: BenchmarkStats;
    hypertable: BenchmarkStats;
    continuous_aggregate?: BenchmarkStats | null;
    speedup?: {
        hypertable_vs_plain?: number | null;
        cagg_vs_plain?: number | null;
    };
};

interface BenchmarkMatrixProps {
    cases: BenchmarkCase[];
    loading: boolean;
}

function formatMs(value?: number | null) {
    if (typeof value !== "number" || Number.isNaN(value)) {
        return "--";
    }
    return `${value.toFixed(3)} ms`;
}

function formatSpeedup(value?: number | null) {
    if (typeof value !== "number" || Number.isNaN(value)) {
        return "--";
    }
    return `${value.toFixed(2)}x`;
}

function speedupClass(value?: number | null) {
    if (typeof value !== "number" || Number.isNaN(value)) {
        return "speedup-neutral";
    }
    return value > 1 ? "speedup-positive" : "speedup-negative";
}

export default function BenchmarkMatrix({ cases, loading }: BenchmarkMatrixProps) {
    return (
        <div className="benchmark-matrix-panel">
            {loading ? (
                <div className="benchmark-loading">Running benchmark, please wait...</div>
            ) : null}

            <div className="benchmark-table-wrapper" style={{ overflowX: "auto" }}>
                <table className="benchmark-table" role="table" aria-label="Benchmark result matrix" style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: "0.9rem",
                }}>
                    <thead style={{
                      backgroundColor: "#152033",
                      borderBottom: "2px solid #273347",
                    }}>
                        <tr>
                            <th style={{
                              padding: "12px",
                              textAlign: "left",
                              fontWeight: "600",
                              color: "#f4f6fb",
                            }}>Query</th>
                            <th style={{
                              padding: "12px",
                              textAlign: "right",
                              fontWeight: "600",
                              color: "#f4f6fb",
                            }}>Plain</th>
                            <th style={{
                              padding: "12px",
                              textAlign: "right",
                              fontWeight: "600",
                              color: "#f4f6fb",
                            }}>Hypertable</th>
                            <th style={{
                              padding: "12px",
                              textAlign: "center",
                              fontWeight: "600",
                              color: "#f4f6fb",
                            }}>Hyper Speedup</th>
                            <th style={{
                              padding: "12px",
                              textAlign: "right",
                              fontWeight: "600",
                              color: "#f4f6fb",
                            }}>Cagg</th>
                            <th style={{
                              padding: "12px",
                              textAlign: "center",
                              fontWeight: "600",
                              color: "#f4f6fb",
                            }}>Cagg Speedup</th>
                            <th style={{
                              padding: "12px",
                              textAlign: "right",
                              fontWeight: "600",
                              color: "#f4f6fb",
                            }}>Rows</th>
                        </tr>
                    </thead>
                    <tbody>
                        {cases.map((row, idx) => (
                            <tr key={row.id} style={{
                              backgroundColor: idx % 2 === 0 ? "#0e1116" : "#111722",
                              borderBottom: "1px solid #273347",
                            }}>
                                <td style={{
                                  padding: "12px",
                                  color: "#f4f6fb",
                                  fontWeight: "500",
                                }}>{row.label}</td>
                                <td style={{
                                  padding: "12px",
                                  textAlign: "right",
                                  color: "#9ea9bd",
                                }}>{formatMs(row.plain?.median_ms)}</td>
                                <td style={{
                                  padding: "12px",
                                  textAlign: "right",
                                  color: "#9ea9bd",
                                }}>{formatMs(row.hypertable?.median_ms)}</td>
                                <td style={{
                                  padding: "12px",
                                  textAlign: "center",
                                }}>
                                    <span className={`speedup-pill ${speedupClass(row.speedup?.hypertable_vs_plain)}`}>
                                        {formatSpeedup(row.speedup?.hypertable_vs_plain)}
                                    </span>
                                </td>
                                <td style={{
                                  padding: "12px",
                                  textAlign: "right",
                                  color: "#9ea9bd",
                                }}>{row.continuous_aggregate ? formatMs(row.continuous_aggregate?.median_ms) : "N/A"}</td>
                                <td style={{
                                  padding: "12px",
                                  textAlign: "center",
                                }}>
                                    {row.continuous_aggregate ? (
                                        <span className={`speedup-pill ${speedupClass(row.speedup?.cagg_vs_plain)}`}>
                                            {formatSpeedup(row.speedup?.cagg_vs_plain)}
                                        </span>
                                    ) : (
                                        "N/A"
                                    )}
                                </td>
                                <td style={{
                                  padding: "12px",
                                  textAlign: "right",
                                  color: "#9ea9bd",
                                }}>{row.plain?.rows ?? "--"}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
