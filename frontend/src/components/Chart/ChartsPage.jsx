import { useEffect, useMemo, useState } from "react";
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

const MAX_TICKS = 2500;
const MIN_SPEED = 0.25;
const MAX_SPEED = 20;
const SPEED_STEP = 0.25;

function formatCompactNumber(value) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function wsBaseUrl() {
  const configured = import.meta.env.VITE_WS_URL;
  if (configured) {
    return configured.replace(/\/$/, "");
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}`;
}

function wsStreamUrl() {
  return `${wsBaseUrl()}/ws/stream`;
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

function buildCandlesFromTicks(ticks, timeframeMinutes) {
  if (!ticks.length) {
    return [];
  }

  const buckets = new Map();
  const bucketMs = timeframeMinutes * 60 * 1000;

  for (const tick of ticks) {
    const date = new Date(tick.time);
    if (Number.isNaN(date.getTime())) {
      continue;
    }

    const bucketStartMs = Math.floor(date.getTime() / bucketMs) * bucketMs;
    const key = new Date(bucketStartMs).toISOString();
    const price = Number(tick.price);
    const volume = Number(tick.volume) || 0;
    const existing = buckets.get(key);

    if (!existing) {
      buckets.set(key, {
        bucket: key,
        open: price,
        high: price,
        low: price,
        close: price,
        volume,
      });
      continue;
    }

    existing.close = price;
    existing.lastTime = tick.time;
    existing.high = Math.max(existing.high, price);
    existing.low = Math.min(existing.low, price);
    existing.volume += volume;
  }

  const candleSeries = Array.from(buckets.values())
    .sort((a, b) => new Date(a.bucket).getTime() - new Date(b.bucket).getTime());

  return candleSeries
    .map((item, index) => ({ ...item, index }));
}

function fallbackCandles(basePrice) {
  return Array.from({ length: 30 }, (_, index) => ({
    index,
    open: basePrice,
    high: basePrice,
    low: basePrice,
    close: basePrice,
    volume: 0,
  }));
}

export default function ChartsPage({ selectedAsset, simulationControls }) {
  const [availableSymbols, setAvailableSymbols] = useState([]);
  const [selectedSymbol, setSelectedSymbol] = useState(selectedAsset.symbol);
  const [timeframe, setTimeframe] = useState(TIMEFRAME_OPTIONS[0]);
  const [ticksBySymbol, setTicksBySymbol] = useState({});
  const [statusBySymbol, setStatusBySymbol] = useState({});
  const [speedBySymbol, setSpeedBySymbol] = useState({});
  const [socketStatus, setSocketStatus] = useState("connecting");
  const [errorMessage, setErrorMessage] = useState("");
  const [speedMultiplier, setSpeedMultiplier] = useState(1);

  useEffect(() => {
    setSelectedSymbol(selectedAsset.symbol);
  }, [selectedAsset.symbol]);

  useEffect(() => {
    let active = true;

    const loadSymbols = async () => {
      try {
        const response = await fetch("/api/market/simulation/symbols");
        if (!response.ok) {
          throw new Error("Failed to load symbols");
        }

        const payload = await response.json();
        const symbols = Array.isArray(payload.symbols) ? payload.symbols : [];
        if (!active) {
          return;
        }

        setAvailableSymbols(symbols);
        if (symbols.length && !symbols.includes(selectedSymbol)) {
          setSelectedSymbol(symbols[0]);
        }
      } catch {
        if (active) {
          setAvailableSymbols([]);
        }
      }
    };

    loadSymbols();
    return () => {
      active = false;
    };
  }, []);

  const symbol = selectedSymbol;
  const ticks = ticksBySymbol[symbol] ?? [];
  const simulationStatus = statusBySymbol[symbol] ?? "loading";
  const busyAction = simulationControls?.busyAction ?? "";

  const candles = useMemo(
    () => buildCandlesFromTicks(ticks, timeframe.minutes),
    [ticks, timeframe],
  );
  const chartCandles = candles.length ? candles : fallbackCandles(selectedAsset.basePrice);
  const livePrice = ticks.length
    ? Number(ticks[ticks.length - 1].price)
    : Number(selectedAsset.basePrice);

  const trendTone = livePrice >= selectedAsset.basePrice ? "positive" : "negative";

  useEffect(() => {
    if (!availableSymbols.length) {
      return;
    }

    const controller = new AbortController();
    let isMounted = true;

    const loadInitialDataForAllSymbols = async () => {
      setErrorMessage("");
      try {
        const responses = await Promise.all(
          availableSymbols.map(async (currentSymbol) => {
            const [ticksResponse, statusResponse] = await Promise.all([
              fetch(`/api/market/ticks?symbol=${encodeURIComponent(currentSymbol)}&limit=${MAX_TICKS}`, {
                signal: controller.signal,
              }),
              fetch(`/api/market/simulation/${encodeURIComponent(currentSymbol)}/status`, {
                signal: controller.signal,
              }),
            ]);

            if (!ticksResponse.ok) {
              throw new Error(`Failed to fetch ticks for ${currentSymbol}`);
            }
            if (!statusResponse.ok) {
              throw new Error(`Failed to fetch simulation status for ${currentSymbol}`);
            }

            const fetchedTicks = await ticksResponse.json();
            const status = await statusResponse.json();
            return {
              symbol: currentSymbol,
              ticks: Array.isArray(fetchedTicks) ? fetchedTicks : [],
              status,
            };
          }),
        );

        if (!isMounted) {
          return;
        }

        const nextTicksBySymbol = {};
        const nextStatusBySymbol = {};
        const nextSpeedBySymbol = {};

        for (const item of responses) {
          nextTicksBySymbol[item.symbol] = item.ticks;
          nextStatusBySymbol[item.symbol] = item.status.status ?? "stopped";
          if (typeof item.status.speed_multiplier === "number") {
            nextSpeedBySymbol[item.symbol] = item.status.speed_multiplier;
          }
        }

        setTicksBySymbol(nextTicksBySymbol);
        setStatusBySymbol(nextStatusBySymbol);
        setSpeedBySymbol(nextSpeedBySymbol);
      } catch (error) {
        if (isMounted && error.name !== "AbortError") {
          setErrorMessage(error.message || "Unable to load chart data");
        }
      }
    };

    loadInitialDataForAllSymbols();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [availableSymbols]);

  useEffect(() => {
    const speed = speedBySymbol[symbol];
    if (typeof speed === "number") {
      setSpeedMultiplier(speed);
    }
  }, [symbol, speedBySymbol]);

  useEffect(() => {
    let active = true;
    let reconnectTimeout = null;
    let socket = null;

    const connect = () => {
      if (!active) {
        return;
      }

      setSocketStatus("connecting");
      socket = new WebSocket(wsStreamUrl());

      socket.onopen = () => {
        if (!active) {
          socket.close();
          return;
        }
        setSocketStatus("connected");
        setErrorMessage("");
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          if (message.type === "tick" && message.tick) {
            const tickSymbol = message.tick.symbol;
            if (!tickSymbol) {
              return;
            }

            setTicksBySymbol((previous) => {
              const previousTicks = previous[tickSymbol] ?? [];
              return {
                ...previous,
                [tickSymbol]: [...previousTicks, message.tick],
              };
            });
            return;
          }

          if (message.type === "simulation_state" && message.state?.status) {
            const stateSymbol = message.state.symbol;
            if (!stateSymbol) {
              return;
            }

            setStatusBySymbol((previous) => ({
              ...previous,
              [stateSymbol]: message.state.status,
            }));

            if (typeof message.state.speed_multiplier === "number") {
              setSpeedBySymbol((previous) => ({
                ...previous,
                [stateSymbol]: message.state.speed_multiplier,
              }));
            }
          }
        } catch {
          setErrorMessage("Received malformed simulation payload");
        }
      };

      socket.onerror = () => {
        if (!active) {
          return;
        }
        setSocketStatus("error");
      };

      socket.onclose = (event) => {
        if (!active) {
          return;
        }

        setSocketStatus("disconnected");
        if (!event.wasClean && event.code !== 1000 && event.code !== 1001) {
          setErrorMessage("Live stream disconnected. Retrying...");
        }

        reconnectTimeout = window.setTimeout(connect, 1200);
      };
    };

    connect();

    return () => {
      active = false;
      if (reconnectTimeout !== null) {
        window.clearTimeout(reconnectTimeout);
      }

      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        socket.close();
      }
    };
  }, []);

  const updateSimulationSpeed = async (nextSpeed) => {
    setSpeedMultiplier(nextSpeed);
    setErrorMessage("");

    try {
      const response = await fetch(
        `/api/market/simulation/speed?speed=${encodeURIComponent(nextSpeed)}`,
        { method: "POST" },
      );

      if (!response.ok) {
        throw new Error("Unable to update simulation speed");
      }

      const payload = await response.json();
      const states = Array.isArray(payload.states) ? payload.states : [];

      if (states.length) {
        setStatusBySymbol((previous) => {
          const next = { ...previous };
          for (const state of states) {
            if (state?.symbol) {
              next[state.symbol] = state.status ?? "stopped";
            }
          }
          return next;
        });

        setSpeedBySymbol((previous) => {
          const next = { ...previous };
          for (const state of states) {
            if (state?.symbol && typeof state.speed_multiplier === "number") {
              next[state.symbol] = state.speed_multiplier;
            }
          }
          return next;
        });
      }
    } catch (error) {
      setErrorMessage(error.message || "Unable to update simulation speed");
    }
  };

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
              onChange={(event) => setSelectedSymbol(event.target.value)}
            >
              {(availableSymbols.length ? availableSymbols : [symbol]).map((item) => (
                <option key={item} value={item}>
                  {item}
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
            <p className="hero-price">{formatPrice(livePrice)}</p>
            <p className="hero-time">Last update: {ticks.length ? formatTimestamp(ticks[ticks.length - 1].time) : "--"}</p>
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
              value={speedMultiplier}
              disabled={busyAction !== ""}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (Number.isFinite(next)) {
                  setSpeedMultiplier(next);
                }
              }}
              onMouseUp={(event) => updateSimulationSpeed(Number(event.currentTarget.value))}
              onTouchEnd={(event) => updateSimulationSpeed(Number(event.currentTarget.value))}
              onKeyUp={(event) => {
                if (event.key.startsWith("Arrow") || event.key === "Home" || event.key === "End") {
                  updateSimulationSpeed(Number(event.currentTarget.value));
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
              onClick={() => {
                setTicksBySymbol({});
                simulationControls?.runAction?.("restart");
              }}
            >
              {busyAction === "restart" ? "Restarting..." : "Restart"}
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
          subtitle={`Timeframe ${timeframe.label} · ${chartCandles.length} candles`}
          right={<Pill tone={trendTone}>{simulationStatus}</Pill>}
          className="chart-panel-large"
        >
          <CandlestickChart data={chartCandles} height={360} timeframeLabel={timeframe.label} />
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
                <strong>{formatPrice(livePrice)}</strong>
              </div>
              <div>
                <span>Candles</span>
                <strong>{chartCandles.length}</strong>
              </div>
              <div>
                <span>Timeframe</span>
                <strong>{timeframe.label}</strong>
              </div>
              <div>
                <span>Session Open</span>
                <strong>{formatPrice(chartCandles[0].open)}</strong>
              </div>
              <div>
                <span>Session High</span>
                <strong>{formatPrice(Math.max(...chartCandles.map((point) => point.high)))}</strong>
              </div>
              <div>
                <span>Session Low</span>
                <strong>{formatPrice(Math.min(...chartCandles.map((point) => point.low)))}</strong>
              </div>
              <div>
                <span>Total Volume</span>
                <strong>
                  <span
                    title={new Intl.NumberFormat("en-US").format(
                      chartCandles.reduce((sum, point) => sum + point.volume, 0),
                    )}
                  >
                    {formatCompactNumber(
                      chartCandles.reduce((sum, point) => sum + point.volume, 0),
                    )}
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
