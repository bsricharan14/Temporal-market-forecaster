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

const TIMEFRAMES = ["1m", "5m", "15m", "1H", "4H", "1D"];

const MAX_TICKS = 2500;

function wsBaseUrl() {
  const configured = import.meta.env.VITE_WS_URL;
  if (configured) {
    return configured.replace(/\/$/, "");
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}`;
}

function buildCandlesFromTicks(ticks, maxCandles = 120) {
  if (!ticks.length) {
    return [];
  }

  const buckets = new Map();
  for (const tick of ticks) {
    const date = new Date(tick.time);
    if (Number.isNaN(date.getTime())) {
      continue;
    }

    date.setSeconds(0, 0);
    const key = date.toISOString();
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
    existing.high = Math.max(existing.high, price);
    existing.low = Math.min(existing.low, price);
    existing.volume += volume;
  }

  return Array.from(buckets.values())
    .sort((a, b) => new Date(a.bucket).getTime() - new Date(b.bucket).getTime())
    .slice(-maxCandles)
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

export default function ChartsPage({ selectedAsset }) {
  const [ticks, setTicks] = useState([]);
  const [simulationStatus, setSimulationStatus] = useState("loading");
  const [socketStatus, setSocketStatus] = useState("connecting");
  const [errorMessage, setErrorMessage] = useState("");
  const [busyAction, setBusyAction] = useState("");

  const symbol = selectedAsset.symbol;

  const candles = useMemo(() => buildCandlesFromTicks(ticks), [ticks]);
  const chartCandles = candles.length ? candles : fallbackCandles(selectedAsset.basePrice);
  const livePrice = ticks.length
    ? Number(ticks[ticks.length - 1].price)
    : Number(selectedAsset.basePrice);

  const trendTone = livePrice >= selectedAsset.basePrice ? "positive" : "negative";

  useEffect(() => {
    let isMounted = true;

    const loadInitialData = async () => {
      setErrorMessage("");
      try {
        const [ticksResponse, statusResponse] = await Promise.all([
          fetch(`/api/market/ticks?symbol=${encodeURIComponent(symbol)}&limit=${MAX_TICKS}`),
          fetch(`/api/market/simulation/${encodeURIComponent(symbol)}/status`),
        ]);

        if (!ticksResponse.ok) {
          throw new Error("Failed to fetch ticks");
        }
        if (!statusResponse.ok) {
          throw new Error("Failed to fetch simulation status");
        }

        const fetchedTicks = await ticksResponse.json();
        const status = await statusResponse.json();

        if (!isMounted) {
          return;
        }

        setTicks(Array.isArray(fetchedTicks) ? fetchedTicks : []);
        setSimulationStatus(status.status ?? "stopped");
      } catch (error) {
        if (isMounted) {
          setErrorMessage(error.message || "Unable to load chart data");
        }
      }
    };

    loadInitialData();

    return () => {
      isMounted = false;
    };
  }, [symbol]);

  useEffect(() => {
    const socket = new WebSocket(`${wsBaseUrl()}/ws/stream/${encodeURIComponent(symbol)}`);

    socket.onopen = () => {
      setSocketStatus("connected");
      setErrorMessage("");
    };

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        if (message.type === "tick" && message.tick) {
          setTicks((previous) => [...previous, message.tick].slice(-MAX_TICKS));
          return;
        }

        if (message.type === "simulation_state" && message.state?.status) {
          setSimulationStatus(message.state.status);
        }
      } catch {
        setErrorMessage("Received malformed simulation payload");
      }
    };

    socket.onerror = () => {
      setSocketStatus("error");
      setErrorMessage("Unable to connect to live stream");
    };

    socket.onclose = () => {
      setSocketStatus("disconnected");
    };

    return () => {
      socket.close();
    };
  }, [symbol]);

  const runSimulationAction = async (action) => {
    setBusyAction(action);
    setErrorMessage("");

    try {
      const response = await fetch(
        `/api/market/simulation/${encodeURIComponent(symbol)}/${action}`,
        { method: "POST" },
      );

      if (!response.ok) {
        throw new Error(`Unable to ${action} simulation`);
      }

      const status = await response.json();
      setSimulationStatus(status.status ?? "stopped");

      if (action === "restart") {
        setTicks([]);
      }
    } catch (error) {
      setErrorMessage(error.message || "Simulation command failed");
    } finally {
      setBusyAction("");
    }
  };

  return (
    <main className="page-shell">
      <header className="section-intro panel">
        <p className="eyebrow">Charts</p>
        <h2 className="headline">Price Action And Context</h2>
        <p className="subline">
          Live chart simulation from tick data loaded into PostgreSQL/TimescaleDB.
        </p>

        <div className="simulation-controls">
          <Pill tone={socketStatus === "connected" ? "positive" : "warning"}>
            Socket: {socketStatus}
          </Pill>
          <Pill tone={simulationStatus === "running" ? "positive" : "neutral"}>
            Simulation: {simulationStatus}
          </Pill>
          <button
            className="sim-btn"
            disabled={busyAction !== ""}
            onClick={() => runSimulationAction("start")}
          >
            {busyAction === "start" ? "Starting..." : "Start"}
          </button>
          <button
            className="sim-btn"
            disabled={busyAction !== ""}
            onClick={() => runSimulationAction("stop")}
          >
            {busyAction === "stop" ? "Stopping..." : "Stop"}
          </button>
          <button
            className="sim-btn"
            disabled={busyAction !== ""}
            onClick={() => runSimulationAction("restart")}
          >
            {busyAction === "restart" ? "Restarting..." : "Restart"}
          </button>
        </div>

        {errorMessage ? <p className="subline simulation-error">{errorMessage}</p> : null}
      </header>

      <section className="content-grid charts-grid">
        <Panel
          title={`${selectedAsset.symbol} Candlestick View`}
          subtitle={`${selectedAsset.name} · Tick stream`}
          right={<Pill tone={trendTone}>{formatPrice(livePrice)}</Pill>}
        >
          <div className="chart-toolbar">
            {TIMEFRAMES.map((timeframe) => (
              <button
                key={timeframe}
                className={`toolbar-chip ${timeframe === "1H" ? "active" : ""}`}
              >
                {timeframe}
              </button>
            ))}
          </div>
          <CandlestickChart data={chartCandles} />
        </Panel>

        <Panel
          title="Chart Stats"
          subtitle="Mock values for this symbol"
          className="chart-stats-panel"
        >
          <div className="info-list">
            <div>
              <span>Last Price</span>
              <strong>{formatPrice(livePrice)}</strong>
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
              <span>Volume</span>
              <strong>
                {new Intl.NumberFormat("en-US").format(
                  chartCandles.reduce((sum, point) => sum + point.volume, 0),
                )}
              </strong>
            </div>
          </div>
        </Panel>
      </section>
    </main>
  );
}
