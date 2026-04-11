import { useEffect, useMemo, useState } from "react";
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

export default function BenchmarkPage({ selectedAsset, simulationControls }) {
  const [windowMinutes, setWindowMinutes] = useState(60);
  const [runs, setRuns] = useState(3);
  const [benchmark, setBenchmark] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastRunAt, setLastRunAt] = useState(null);
  const busyAction = simulationControls?.busyAction ?? "";

  const runBenchmark = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/market/benchmark?symbol=${encodeURIComponent(selectedAsset.symbol)}&window_minutes=${windowMinutes}&runs=${runs}`,
      );
      if (!response.ok) {
        throw new Error("Failed to execute benchmark");
      }

      const payload = await response.json();
      setBenchmark(payload);
      setLastRunAt(new Date());
    } catch (fetchError) {
      setError(fetchError.message || "Unable to run benchmark");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runBenchmark();
  }, [selectedAsset.symbol, windowMinutes, runs]);

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
            {loading ? "Running..." : "Run Benchmark"}
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
        <div className="benchmark-matrix-wrap">
          <table className="benchmark-matrix" role="table" aria-label="Timescale benchmark matrix">
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
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.label}</td>
                  <td className="negative">{formatMs(row.plain?.median_ms)}</td>
                  <td className="positive">{formatMs(row.hypertable?.median_ms)}</td>
                  <td>{row.speedup?.hypertable_vs_plain ? `${row.speedup.hypertable_vs_plain}x` : "--"}</td>
                  <td>{row.continuous_aggregate ? formatMs(row.continuous_aggregate?.median_ms) : "N/A"}</td>
                  <td>{row.speedup?.cagg_vs_plain ? `${row.speedup.cagg_vs_plain}x` : "N/A"}</td>
                  <td>
                    {row.plain?.rows ?? "--"}
                    <span className="benchmark-rows-meta"> / {row.hypertable?.rows ?? "--"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
