import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Panel from "../ui/Panel";
import MetricCard from "../ui/MetricCard";

const WINDOW_OPTIONS = [15, 60, 240, 1440];
const RUN_OPTIONS = [1, 3, 5];

function formatMs(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "--";
  }
  return `${value.toFixed(3)} ms`;
}

function formatSpeedup(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "--";
  }
  return `${value.toFixed(2)}x`;
}

function speedupClass(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "speedup-neutral";
  }
  return value > 1 ? "speedup-positive" : "speedup-negative";
}

function BenchmarkMatrix({ cases, loading }) {
  return (
    <div className="benchmark-matrix-panel">
      {loading ? (
        <div className="benchmark-loading">Running benchmark, please wait...</div>
      ) : null}

      <div className="benchmark-table-wrapper">
        <table className="benchmark-table" role="table" aria-label="Benchmark result matrix">
          <thead>
            <tr>
              <th>Query</th>
              <th>Plain</th>
              <th>Hypertable</th>
              <th>Hyper Speedup</th>
              <th>Cagg</th>
              <th>Cagg Speedup</th>
              <th>Rows</th>
            </tr>
          </thead>
          <tbody>
            {cases.map((row, idx) => (
              <tr key={row.id} style={{ backgroundColor: idx % 2 === 0 ? "#0e1116" : "#111722" }}>
                <td style={{ color: "#f4f6fb", fontWeight: "500" }}>{row.label}</td>
                <td style={{ color: "#9ea9bd" }}>{formatMs(row.plain?.median_ms)}</td>
                <td style={{ color: "#9ea9bd" }}>{formatMs(row.hypertable?.median_ms)}</td>
                <td>
                  <span className={`speedup-pill ${speedupClass(row.speedup?.hypertable_vs_plain)}`}>
                    {formatSpeedup(row.speedup?.hypertable_vs_plain)}
                  </span>
                </td>
                <td style={{ color: "#9ea9bd" }}>
                  {row.continuous_aggregate ? formatMs(row.continuous_aggregate?.median_ms) : "N/A"}
                </td>
                <td>
                  {row.continuous_aggregate ? (
                    <span className={`speedup-pill ${speedupClass(row.speedup?.cagg_vs_plain)}`}>
                      {formatSpeedup(row.speedup?.cagg_vs_plain)}
                    </span>
                  ) : (
                    "N/A"
                  )}
                </td>
                <td style={{ color: "#9ea9bd" }}>{row.plain?.rows ?? "--"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function BenchmarkPage({ selectedAsset, simulationControls }) {
  const [windowMinutes, setWindowMinutes] = useState(60);
  const [runs, setRuns] = useState(3);
  const [benchmark, setBenchmark] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastRunAt, setLastRunAt] = useState(null);
  const benchmarkAbortRef = useRef(null);
  const busyAction = simulationControls?.busyAction ?? "";

  const runBenchmark = useCallback(async () => {
    if (benchmarkAbortRef.current) {
      benchmarkAbortRef.current.abort();
    }

    const controller = new AbortController();
    benchmarkAbortRef.current = controller;

    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/market/benchmark?symbol=${encodeURIComponent(selectedAsset.symbol)}&window=${encodeURIComponent(`${windowMinutes} minutes`)}&runs=${runs}`,
        { signal: controller.signal },
      );
      if (!response.ok) {
        const body = await response.text();
        throw new Error(body || "Failed to execute benchmark");
      }

      const payload = await response.json();
      setBenchmark(payload);
      setLastRunAt(new Date());
    } catch (fetchError) {
      if (fetchError?.name === "AbortError") {
        return;
      }
      console.error("Benchmark fetch error:", fetchError);
      setError(fetchError.message || "Unable to run benchmark");
    } finally {
      if (benchmarkAbortRef.current === controller) {
        benchmarkAbortRef.current = null;
      }
      setLoading(false);
    }
  }, [runs, selectedAsset.symbol, windowMinutes]);

  useEffect(() => {
    runBenchmark();
    return () => {
      if (benchmarkAbortRef.current) {
        benchmarkAbortRef.current.abort();
        benchmarkAbortRef.current = null;
      }
    };
  }, [runBenchmark]);

  const summary = useMemo(() => {
    const suite = Array.isArray(benchmark?.cases) ? benchmark.cases : [];
    const avgSpeedup = benchmark?.summary?.avg_hypertable_speedup;
    const avgCaggSpeedup = benchmark?.summary?.avg_cagg_speedup;
    const bestCase = benchmark?.summary?.best_hypertable_case;
    const allMedians = suite
      .flatMap((item) => [
        item?.plain?.median_ms,
        item?.hypertable?.median_ms,
        item?.continuous_aggregate?.median_ms,
      ])
      .filter((value) => typeof value === "number");

    const fastestMs = allMedians.length ? Math.min(...allMedians) : null;

    return {
      avgSpeedup,
      avgCaggSpeedup,
      bestCase,
      fastestMs,
    };
  }, [benchmark]);

  const rows = useMemo(() => {
    if (!Array.isArray(benchmark?.cases)) {
      return [];
    }

    return benchmark.cases;
  }, [benchmark]);

  return (
    <main className="page-shell">
      <header className="section-intro panel">
        <p className="eyebrow">Benchmark</p>
        <h2 className="headline">TimescaleDB vs Plain Table</h2>
        <p className="subline">
          Live benchmark for {selectedAsset.symbol}. Compare regular table queries against hypertable and continuous aggregates.
        </p>

        <div className="chart-controls-actions">
          <button
            className="sim-btn"
            disabled={busyAction !== ""}
            onClick={() => simulationControls?.runAction?.("start")}
          >
            {busyAction === "start" ? "Starting..." : "Start"}
          </button>
          <button
            className="sim-btn"
            disabled={busyAction !== ""}
            onClick={() => simulationControls?.runAction?.("stop")}
          >
            {busyAction === "stop" ? "Stopping..." : "Stop"}
          </button>
          <button
            className="sim-btn"
            disabled={busyAction !== ""}
            onClick={() => simulationControls?.runAction?.("restart")}
          >
            {busyAction === "restart" ? "Restarting..." : "Restart"}
          </button>
          <button
            className="sim-btn"
            disabled={busyAction !== ""}
            onClick={() => simulationControls?.runAction?.("clear")}
          >
            {busyAction === "clear" ? "Clearing..." : "Clear"}
          </button>
        </div>

        <div className="header-controls">
          <label>
            <span className="select-label">Window</span>
            <select
              className="symbol-select-inline"
              value={windowMinutes}
              onChange={(event) => setWindowMinutes(Number(event.target.value))}
            >
              {WINDOW_OPTIONS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes}m
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="select-label">Runs</span>
            <select
              className="symbol-select-inline"
              value={runs}
              onChange={(event) => setRuns(Number(event.target.value))}
            >
              {RUN_OPTIONS.map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </select>
          </label>
          <button className="sim-btn" disabled={loading} onClick={runBenchmark}>
            {loading ? "Running benchmark..." : "Run Benchmark"}
          </button>
        </div>

        {error ? <p className="subline simulation-error">{error}</p> : null}
        {simulationControls?.errorMessage ? (
          <p className="subline simulation-error">{simulationControls.errorMessage}</p>
        ) : null}
      </header>

      <section className="benchmark-summary">
        <MetricCard
          label="Avg Hyper Speedup"
          value={summary.avgSpeedup ? `${summary.avgSpeedup}x` : "--"}
          delta="plain vs hypertable"
          tone="positive"
          helper={`${windowMinutes}m window · ${runs} run(s)`}
        />
        <MetricCard
          label="Avg Cagg Speedup"
          value={summary.avgCaggSpeedup ? `${summary.avgCaggSpeedup}x` : "--"}
          delta="plain vs cagg"
          tone="positive"
          helper={summary.bestCase ? `Best: ${summary.bestCase.label} (${summary.bestCase.speedup}x)` : "No cagg data"}
        />
        <MetricCard
          label="Fastest Median"
          value={summary.fastestMs ? formatMs(summary.fastestMs) : "--"}
          delta={lastRunAt ? `Last run ${lastRunAt.toLocaleTimeString()}` : "No runs yet"}
          tone="neutral"
          helper={`Symbol ${selectedAsset.symbol}`}
        />
      </section>

      <Panel title="Benchmark Matrix" subtitle="Median latency comparison: plain table vs Timescale options">
        <BenchmarkMatrix cases={rows} loading={loading} />
      </Panel>

      <Panel title="Method" subtitle="How this benchmark is executed for demonstration">
        <div className="info-list">
          <div>
            <span>Latency Metric</span>
            <strong>Median across {runs} run(s)</strong>
          </div>
          <div>
            <span>Compared Objects</span>
            <strong>market_ticks_plain vs market_ticks vs ohlcv_1m</strong>
          </div>
          <div>
            <span>Window Filter</span>
            <strong>NOW() - {windowMinutes} minutes</strong>
          </div>
        </div>
      </Panel>
    </main>
  );
}
