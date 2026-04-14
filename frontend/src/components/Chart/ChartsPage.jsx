import { useEffect, useMemo, useState, useCallback } from "react";
import CandlestickChart from "./CandlestickChart";
import Panel from "../ui/Panel";
import Pill from "../ui/Pill";

function formatPrice(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value > 1000 ? 0 : 2,
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

function formatCompactNumber(value) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
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

export default function ChartsPage({
  assets,
  selectedAsset,
  onSymbolChange,
  candles1m,
  livePrice,
  simulationStatus,
  speedMultiplier,
  socketStatus,
  errorMessage,
  isInitializing,
  lastTickTime,
  simulationControls,
}) {
  const [timeframe, setTimeframe] = useState(TIMEFRAME_OPTIONS[0]);
  const [localSpeed, setLocalSpeed] = useState(speedMultiplier);
  const [chartOffset, setChartOffset] = useState(0);

  const symbol = selectedAsset.symbol;
  const busyAction = simulationControls?.busyAction ?? "";

  useEffect(() => {
    setLocalSpeed(speedMultiplier);
  }, [speedMultiplier]);

  // Reset chart offset when symbol changes
  useEffect(() => {
    setChartOffset(0);
  }, [symbol]);

  const allChartCandles = useMemo(
    () => aggregateCandles1m(candles1m, timeframe.minutes),
    [candles1m, timeframe],
  );

  // Keep max 50 candles visible, auto-scroll to show latest candles
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

  // Keyboard shortcuts for chart scrolling
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (allChartCandles.length === 0) return;
      
      if (e.key === "ArrowLeft" && e.ctrlKey) {
        e.preventDefault();
        handleChartScroll("left");
      } else if (e.key === "ArrowRight" && e.ctrlKey) {
        e.preventDefault();
        handleChartScroll("right");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleChartScroll, allChartCandles.length]);

  const displayLivePrice = livePrice ?? selectedAsset.basePrice;

  const trendTone = displayLivePrice >= selectedAsset.basePrice ? "positive" : "negative";

  return (
    <main className="page-shell">
      <header className="section-intro panel">
        <p className="eyebrow">Charts</p>
        <div className="header-title-row">
          <h2 className="headline">Live Tick Ingestion Chart</h2>
          <label className="charts-select-group-inline" htmlFor="chartSymbolSelect">
            <select
              id="chartSymbolSelect"
              className="symbol-select-inline"
              value={symbol}
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
          Candles are built from ingested ticks in real time. Stop pauses, Start resumes, Restart clears all table data and re-ingests.
        </p>

        <div className="chart-hero">
          <div>
            <p className="hero-label">Current Price</p>
            <p className="hero-price">{formatPrice(displayLivePrice)}</p>
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
            <label htmlFor="simulationSpeedSlider">Speed {speedMultiplier.toFixed(2)}x</label>
            <input
              id="simulationSpeedSlider"
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

        {errorMessage || simulationControls?.errorMessage ? (
          <p className="subline simulation-error">{errorMessage || simulationControls.errorMessage}</p>
        ) : null}
      </header>

      <section className="charts-main-section">
        <Panel
          title={`${symbol} Candlestick View`}
          subtitle={`Timeframe ${timeframe.label} · ${chartCandles.length} / ${allChartCandles.length} candles`}
          right={<Pill tone={trendTone}>{simulationStatus}</Pill>}
          className="chart-panel-large"
        >
          {isInitializing ? (
            <div className="chart-wrap chart-empty" style={{ height: 360 }}>
              Loading Tick Data...
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <button
                className="chart-nav-btn"
                onClick={() => handleChartScroll("left")}
                disabled={chartOffset === 0 || allChartCandles.length === 0}
                title="Scroll to older candles"
              >
                ←
              </button>
              <div style={{ flex: 1 }}>
                <CandlestickChart data={chartCandles} height={360} timeframeLabel={timeframe.label} />
              </div>
              <button
                className="chart-nav-btn"
                onClick={() => handleChartScroll("right")}
                disabled={chartOffset >= Math.max(0, allChartCandles.length - MAX_VISIBLE_CANDLES) || allChartCandles.length === 0}
                title="Scroll to newer candles"
              >
                →
              </button>
            </div>
          )}
        </Panel>

        <div className="charts-stats-row">
          <Panel
            title="Chart Stats"
            subtitle="Computed from ingested candle data"
            className="chart-stats-panel"
          >
            <div className="info-list">
              <div>
                <span>Last Price</span>
                <strong>{formatPrice(displayLivePrice)}</strong>
              </div>
              <div>
                <span>Candles</span>
                <strong>{chartCandles.length} / {allChartCandles.length}</strong>
              </div>
              <div>
                <span>Timeframe</span>
                <strong>{timeframe.label}</strong>
              </div>
              <div>
                <span>Session Open</span>
                <strong>{chartCandles.length ? formatPrice(chartCandles[0].open) : "--"}</strong>
              </div>
              <div>
                <span>Session High</span>
                <strong>{chartCandles.length ? formatPrice(Math.max(...chartCandles.map((point) => point.high))) : "--"}</strong>
              </div>
              <div>
                <span>Session Low</span>
                <strong>{chartCandles.length ? formatPrice(Math.min(...chartCandles.map((point) => point.low))) : "--"}</strong>
              </div>
              <div>
                <span>Total Volume</span>
                <strong>
                  <span
                    title={chartCandles.length ? new Intl.NumberFormat("en-US").format(
                      chartCandles.reduce((sum, point) => sum + point.volume, 0),
                    ) : ""}
                  >
                    {chartCandles.length ? formatCompactNumber(
                      chartCandles.reduce((sum, point) => sum + point.volume, 0),
                    ) : "--"}
                  </span>
                </strong>
              </div>
              <div>
                <span>Last Candle End</span>
                <strong>{chartCandles.length ? formatTimestamp(chartCandles[chartCandles.length - 1].bucket) : "--"}</strong>
              </div>
            </div>
          </Panel>
        </div>
      </section>

    </main>
  );
}
