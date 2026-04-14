import { useEffect, useMemo, useState, useCallback } from "react";
import CandlestickChart from "../Chart/CandlestickChart";
import PredictionsPanel from "../Predictions/PredictionsPanel";
import MetricCard from "../ui/MetricCard";
import Panel from "../ui/Panel";
import Pill from "../ui/Pill";

function formatPrice(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value > 1000 ? 0 : 2,
  }).format(value);
}

function formatDelta(basePrice, livePrice) {
  const change = Number((livePrice - basePrice).toFixed(2));
  const percent = Number(((change / basePrice) * 100).toFixed(2));
  return { change, percent };
}

function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatCompactNumber(value) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

const TIMEFRAME_OPTIONS = [
  { key: "1m", label: "1m", minutes: 1, maxCandles: 120 },
  { key: "5m", label: "5m", minutes: 5, maxCandles: 120 },
  { key: "15m", label: "15m", minutes: 15, maxCandles: 120 },
  { key: "1h", label: "1h", minutes: 60, maxCandles: 96 },
  { key: "4h", label: "4h", minutes: 240, maxCandles: 120 },
  { key: "1d", label: "1d", minutes: 1440, maxCandles: 120 },
];

const MIN_SPEED = 0.25;
const MAX_SPEED = 20;
const SPEED_STEP = 0.25;

function aggregateCandles1m(candles1m, timeframeMinutes) {
  if (!candles1m || !candles1m.length) {
    return [];
  }

  if (timeframeMinutes === 1) {
    return candles1m.map((c, index) => ({ ...c, index }));
  }

  const buckets = new Map();
  const bucketMs = timeframeMinutes * 60 * 1000;

  for (const candle of candles1m) {
    const candleTime = new Date(candle.bucket).getTime();
    if (Number.isNaN(candleTime)) continue;

    const bucketStartMs = Math.floor(candleTime / bucketMs) * bucketMs;
    const key = new Date(bucketStartMs).toISOString();

    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, {
        bucket: key,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      });
    } else {
      existing.high = Math.max(existing.high, candle.high);
      existing.low = Math.min(existing.low, candle.low);
      existing.close = candle.close;
      existing.volume += candle.volume;
    }
  }

  return Array.from(buckets.values())
    .sort((a, b) => new Date(a.bucket).getTime() - new Date(b.bucket).getTime())
    .map((item, index) => ({ ...item, index }));
}

export default function Dashboard({
  assets,
  onSymbolChange,
  selectedAsset,
  candles1m,
  livePrice,
  simulationStatus,
  speedMultiplier,
  socketStatus,
  errorMessage,
  isInitializing,
  predictions,
  lastTickTime,
  simulationControls,
}) {
  const [benchmarkSummary, setBenchmarkSummary] = useState(null);
  const [dashboardError, setDashboardError] = useState("");
  const [timeframe, setTimeframe] = useState(TIMEFRAME_OPTIONS[0]); // Default 1m to show seconds
  const [localSpeed, setLocalSpeed] = useState(speedMultiplier);
  const [chartOffset, setChartOffset] = useState(0);

  useEffect(() => {
    setLocalSpeed(speedMultiplier);
  }, [speedMultiplier]);

  const allChartCandles = useMemo(() => aggregateCandles1m(candles1m, timeframe.minutes), [candles1m, timeframe]);
  
  const MAX_VISIBLE_CANDLES = 50;
  
  useEffect(() => {
    // Auto-scroll to keep showing the latest candles
    if (allChartCandles.length > MAX_VISIBLE_CANDLES) {
      setChartOffset(Math.max(0, allChartCandles.length - MAX_VISIBLE_CANDLES));
    } else {
      setChartOffset(0);
    }
  }, [allChartCandles.length]);

  const chartCandles = useMemo(() => {
    if (allChartCandles.length <= MAX_VISIBLE_CANDLES) {
      return allChartCandles;
    }
    return allChartCandles.slice(chartOffset, chartOffset + MAX_VISIBLE_CANDLES);
  }, [allChartCandles, chartOffset]);

  const handleChartScroll = useCallback((direction) => {
    if (allChartCandles.length === 0) return;
    
    const step = 5;
    setChartOffset((prev) => {
      if (direction === "left") {
        return Math.max(0, prev - step);
      } else {
        return Math.min(
          Math.max(0, allChartCandles.length - MAX_VISIBLE_CANDLES),
          prev + step
        );
      }
    });
  }, [allChartCandles.length]);

  const currentLivePrice = livePrice ?? selectedAsset.basePrice;
  const movement = formatDelta(selectedAsset.basePrice, currentLivePrice);
  const movementTone = movement.change >= 0 ? "positive" : "negative";
  const busyAction = simulationControls?.busyAction ?? "";

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    const loadDashboardData = async () => {
      setDashboardError("");

      const benchmarkUrl = `/api/market/benchmark?symbol=${encodeURIComponent(selectedAsset.symbol)}&window=${encodeURIComponent("60 minutes")}&runs=3`;

      try {
        const benchmarkResult = await fetch(benchmarkUrl, { signal: controller.signal });
        if (active && benchmarkResult.ok) {
          const summaryData = await benchmarkResult.json();
          setBenchmarkSummary(summaryData.summary ?? null);
        } else if (active) {
          setBenchmarkSummary(null);
        }
      } catch (error) {
        if (active && error.name !== "AbortError") {
          setDashboardError("Benchmark fetch failed");
        }
      }
    };

    loadDashboardData();
    return () => {
      active = false;
      controller.abort();
    };
  }, [selectedAsset.symbol]);

  return (
    <main className="page-shell">
      <header className="section-intro panel">
        <p className="eyebrow">Dashboard</p>
        <div className="header-title-row">
          <h2 className="headline">Portfolio Snapshot For {selectedAsset.symbol}</h2>
          <label className="charts-select-group-inline" htmlFor="dashboardSymbolSelect">
            <select
              id="dashboardSymbolSelect"
              className="symbol-select-inline"
              value={selectedAsset.symbol}
              onChange={(event) => onSymbolChange(event.target.value)}
            >
              {assets.map((item) => (
                <option key={item.symbol} value={item.symbol}>
                  {item.symbol}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="subline">
          Live streaming pricing with real chart, predictions, and aggregate insights.
        </p>

        <div className="chart-hero">
          <div>
            <p className="hero-label">Current Price</p>
            <p className="hero-price">{formatPrice(currentLivePrice)}</p>
            <p className="hero-time">Last update: {lastTickTime ? formatTimestamp(lastTickTime) : "--"}</p>
          </div>
          <div className="hero-pills">
            <Pill tone={socketStatus === "connected" ? "positive" : "warning"}>
              Socket: {socketStatus}
            </Pill>
            <Pill tone={simulationStatus === "running" ? "positive" : "neutral"}>
              Simulation: {simulationStatus}
            </Pill>
          </div>
        </div>

        <div className="simulation-controls">
          <div className="chart-controls-left">
            <div className="timeframe-group" role="group" aria-label="Chart timeframe">
              {TIMEFRAME_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  className={`toolbar-chip ${timeframe.key === option.key ? "active" : ""}`}
                  onClick={() => setTimeframe(option)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="speed-control" aria-label="Simulation speed control">
            <label htmlFor="dashboardSimulationSpeedSlider">Speed {speedMultiplier.toFixed(2)}x</label>
            <input
              id="dashboardSimulationSpeedSlider"
              type="range"
              min={MIN_SPEED}
              max={MAX_SPEED}
              step={SPEED_STEP}
              value={localSpeed}
              disabled={busyAction !== ""}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (Number.isFinite(next)) {
                  setLocalSpeed(next);
                }
              }}
              onMouseUp={(event) => simulationControls?.updateSpeed?.(Number(event.currentTarget.value))}
              onTouchEnd={(event) => simulationControls?.updateSpeed?.(Number(event.currentTarget.value))}
              onKeyUp={(event) => {
                if (event.key.startsWith("Arrow") || event.key === "Home" || event.key === "End") {
                  simulationControls?.updateSpeed?.(Number(event.currentTarget.value));
                }
              }}
            />
          </div>

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
        </div>

        {dashboardError ? <p className="subline simulation-error">{dashboardError}</p> : null}
        {errorMessage || simulationControls?.errorMessage ? (
          <p className="subline simulation-error">{errorMessage || simulationControls.errorMessage}</p>
        ) : null}
      </header>

      <section className="stats-grid">
         {/* Removed the 'Live Price' MetricCard to avoid duplication with the chart-hero up above */}
        <MetricCard
          label="Predicted Next Candle"
          value="Bullish"
          delta="74% confidence"
          tone="positive"
          helper="XGBoost Classification"
        />
        <MetricCard
          label="Avg Hyper Speedup"
          value={benchmarkSummary?.avg_hypertable_speedup ? `${benchmarkSummary.avg_hypertable_speedup}x` : "--"}
          delta="plain vs hypertable"
          tone={benchmarkSummary?.avg_hypertable_speedup > 1 ? "positive" : "negative"}
          helper="60m window · 3 runs"
        />
        <MetricCard
          label="Avg Cagg Speedup"
          value={benchmarkSummary?.avg_cagg_speedup ? `${benchmarkSummary.avg_cagg_speedup}x` : "--"}
          delta="plain vs cagg"
          tone={benchmarkSummary?.avg_cagg_speedup > 1 ? "positive" : "neutral"}
          helper={benchmarkSummary?.best_hypertable_case ? `Best ${benchmarkSummary.best_hypertable_case.label}` : "No cagg data"}
        />
      </section>

      <section className="full-width">
        <Panel
          title={`${selectedAsset.symbol} Candlestick View`}
          right={<Pill tone={movementTone}>{movement.change >= 0 ? "Uptrend" : "Pullback"}</Pill>}
          className="chart-panel-large"
        >
          {isInitializing ? (
            <div className="chart-wrap chart-empty" style={{ height: 360 }}>
              Loading Tick Data...
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: "8px", minHeight: 360 }}>
              <button
                className="chart-nav-btn"
                onClick={() => handleChartScroll("left")}
                disabled={chartOffset === 0 || allChartCandles.length === 0}
                title="Scroll to older candles"
                style={{ fontSize: "16px", padding: "8px 12px", flexShrink: 0 }}
              >
                ←
              </button>
              <div style={{ flex: 1, overflowY: "hidden" }}>
                <CandlestickChart data={chartCandles} height={360} timeframeLabel={timeframe.label} />
              </div>
              <button
                className="chart-nav-btn"
                onClick={() => handleChartScroll("right")}
                disabled={chartOffset >= Math.max(0, allChartCandles.length - MAX_VISIBLE_CANDLES) || allChartCandles.length === 0}
                title="Scroll to newer candles"
                style={{ fontSize: "16px", padding: "8px 12px", flexShrink: 0 }}
              >
                →
              </button>
            </div>
          )}
        </Panel>
      </section>

      <section className="full-width">
        <PredictionsPanel
          symbol={selectedAsset.symbol}
          regime={selectedAsset.regime}
          predictions={predictions}
        />
      </section>
    </main>
  );
}
