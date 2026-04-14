import { useEffect, useMemo, useRef, useState } from "react";
import Dashboard from "./components/Dashboard/Dashboard";
import ChartsPage from "./components/Chart/ChartsPage";
import MlPredictionsPage from "./components/Predictions/MlPredictionsPage";
import BenchmarkPage from "./components/Benchmark/BenchmarkPage";

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

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Request failed (${response.status})`);
    }
    return await response.json();
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Request timed out. Please try again.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

const MAX_TICKS = 2500;

const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "charts", label: "Charts" },
  { id: "ml", label: "ML Predictions" },
  { id: "benchmark", label: "Benchmark" },
];

const ASSETS = [
  {
    symbol: "AAPL",
    name: "Apple Inc.",
    sector: "Technology",
    marketCap: "$2.81T",
    basePrice: 182.45,
    regime: "Trending",
  },
  {
    symbol: "MSFT",
    name: "Microsoft Corp.",
    sector: "Technology",
    marketCap: "$3.11T",
    basePrice: 418.72,
    regime: "Consolidating",
  },
  {
    symbol: "NVDA",
    name: "NVIDIA Corp.",
    sector: "Semiconductors",
    marketCap: "$2.16T",
    basePrice: 875.3,
    regime: "Volatile",
  },
  {
    symbol: "TSLA",
    name: "Tesla Inc.",
    sector: "EV/Auto",
    marketCap: "$631B",
    basePrice: 198.41,
    regime: "Trending",
  },
  {
    symbol: "SPY",
    name: "SPDR S&P 500 ETF",
    sector: "Index ETF",
    marketCap: "$490B",
    basePrice: 512.34,
    regime: "Trending",
  },
];

function getFallbackPredictions(symbol) {
  return [
    { title: "Trend Classifier", model: "XGBoost", value: "Offline", confidence: 0, tone: "neutral", note: "Waiting for database inference..." },
    { title: "Volatility Regressor", model: "LightGBM Regressor", value: "Offline", confidence: 0, tone: "neutral", note: "Waiting for database inference..." },
    { title: "Regime Clusterer", model: "K-Means (k=3)", value: "Offline", confidence: 0, tone: "neutral", note: "Waiting for database inference..." },
    { title: "Volume Surge Predictor", model: "XGBoost Regressor", value: "Offline", confidence: 0, tone: "neutral", note: "Waiting for database inference..." },
    { title: "Next-Day Gap Predictor", model: "XGBoost Multi-Class", value: "Offline", confidence: 0, tone: "neutral", note: "Waiting for database inference..." },
  ];
}

export default function App() {
  const [activePage, setActivePage] = useState("dashboard");
  const [selectedSymbol, setSelectedSymbol] = useState(ASSETS[0].symbol);
  const [availableSymbols, setAvailableSymbols] = useState([]);
  
  // Market Simulation States
  const [candles1mBySymbol, setCandles1mBySymbol] = useState({});
  const [livePriceBySymbol, setLivePriceBySymbol] = useState({});
  const [statusBySymbol, setStatusBySymbol] = useState({});
  const [speedBySymbol, setSpeedBySymbol] = useState({});
  const [socketStatus, setSocketStatus] = useState("connecting");
  const [errorMessage, setErrorMessage] = useState("");
  
  const [globalBusyAction, setGlobalBusyAction] = useState("");
  const [globalSimulationError, setGlobalSimulationError] = useState("");
  const [isInitializing, setIsInitializing] = useState(true);
  const [lastTickTimeBySymbol, setLastTickTimeBySymbol] = useState({});
  const isInitializingRef = useRef(true);

  useEffect(() => {
    isInitializingRef.current = isInitializing;
  }, [isInitializing]);

  // Symbol Management
  const selectableAssets = useMemo(() => {
    if (!availableSymbols.length) return ASSETS;
    const filtered = ASSETS.filter((asset) => availableSymbols.includes(asset.symbol));
    return filtered.length ? filtered : ASSETS;
  }, [availableSymbols]);

  const selectedAsset = useMemo(
    () => selectableAssets.find((asset) => asset.symbol === selectedSymbol) ?? selectableAssets[0],
    [selectedSymbol, selectableAssets],
  );

  useEffect(() => {
    if (!selectableAssets.find((asset) => asset.symbol === selectedSymbol)) {
      setSelectedSymbol(selectableAssets[0].symbol);
    }
  }, [selectableAssets, selectedSymbol]);

  useEffect(() => {
    let active = true;
    const loadSymbols = async () => {
      try {
        const response = await fetch("/api/market/simulation/symbols");
        if (!response.ok) return;
        const payload = await response.json();
        if (!active) return;
        setAvailableSymbols(Array.isArray(payload.symbols) ? payload.symbols : []);
      } catch {
        // Keep fallback asset list
      }
    };
    loadSymbols();
    return () => { active = false; };
  }, []);

  // Initial Fetch of Ticks and Status
  useEffect(() => {
    if (!availableSymbols.length) return;
    const controller = new AbortController();
    let isMounted = true;

    const loadInitialDataForAllSymbols = async () => {
      setErrorMessage("");
      setIsInitializing(true);
      try {
        const responses = await Promise.all(
          availableSymbols.map(async (currentSymbol) => {
            const [ohlcvResponse, statusResponse] = await Promise.all([
              fetch(`/api/market/ohlcv?symbol=${encodeURIComponent(currentSymbol)}&limit=${MAX_TICKS}`, {
                signal: controller.signal,
              }),
              fetch(`/api/market/simulation/${encodeURIComponent(currentSymbol)}/status`, {
                signal: controller.signal,
              }),
            ]);

            if (!ohlcvResponse.ok) throw new Error(`Failed to fetch ohlcv for ${currentSymbol}`);
            if (!statusResponse.ok) throw new Error(`Failed to fetch simulation status for ${currentSymbol}`);

            const fetchedOhlcv = await ohlcvResponse.json();
            const status = await statusResponse.json();
            
            // The latest 1m close price is an acceptable initial livePrice
            const parsedOhlcv = Array.isArray(fetchedOhlcv) ? fetchedOhlcv : [];
            const initialLivePrice = parsedOhlcv.length > 0 ? parsedOhlcv[parsedOhlcv.length - 1].close : null;

            return {
              symbol: currentSymbol,
              candles: parsedOhlcv,
              initialLivePrice,
              status,
            };
          }),
        );

        if (!isMounted) return;

        const nextCandlesBySymbol = {};
        const nextLivePriceBySymbol = {};
        const nextStatusBySymbol = {};
        const nextSpeedBySymbol = {};

        for (const item of responses) {
          nextCandlesBySymbol[item.symbol] = item.candles;
          if (item.initialLivePrice !== null) {
            nextLivePriceBySymbol[item.symbol] = item.initialLivePrice;
          }
          nextStatusBySymbol[item.symbol] = item.status.status ?? "stopped";
          if (typeof item.status.speed_multiplier === "number") {
            nextSpeedBySymbol[item.symbol] = item.status.speed_multiplier;
          }
        }

        setCandles1mBySymbol(nextCandlesBySymbol);
        setLivePriceBySymbol((prev) => ({ ...prev, ...nextLivePriceBySymbol }));
        setStatusBySymbol(nextStatusBySymbol);
        setSpeedBySymbol(nextSpeedBySymbol);
      } catch (error) {
        if (isMounted && error.name !== "AbortError") {
          setErrorMessage(error.message || "Unable to load chart data");
        }
      } finally {
        if (isMounted) {
          setIsInitializing(false);
        }
      }
    };

    loadInitialDataForAllSymbols();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [availableSymbols]);

  // Detect restart (all candles cleared) and ensure isInitializing is false
  useEffect(() => {
    const allCandlesEmpty = Object.values(candles1mBySymbol).every(candles => !candles || candles.length === 0);
    if (allCandlesEmpty && Object.keys(candles1mBySymbol).length > 0 && isInitializing) {
      setIsInitializing(false);
    }
  }, [candles1mBySymbol, isInitializing]);

  // WebSocket Connection
  useEffect(() => {
    let active = true;
    let reconnectTimeout = null;
    let socket = null;

    const connect = () => {
      if (!active) return;

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
            if (!tickSymbol) return;

            // Skip ticks only during initial data load
            // Allow ticks to process after initial load and after restart
            if (isInitializingRef.current) return;

            // Track last tick timestamp per symbol and keep it monotonic.
            setLastTickTimeBySymbol((previous) => {
              const nextIso = message.tick.time;
              const previousIso = previous[tickSymbol];
              if (!nextIso) return previous;
              if (!previousIso) return { ...previous, [tickSymbol]: nextIso };

              const nextTs = new Date(nextIso).getTime();
              const previousTs = new Date(previousIso).getTime();
              if (Number.isNaN(nextTs) || Number.isNaN(previousTs) || nextTs < previousTs) {
                return previous;
              }
              if (nextTs === previousTs) return previous;
              return { ...previous, [tickSymbol]: nextIso };
            });

            const price = Number(message.tick.price);
            const volume = Number(message.tick.volume) || 0;

            setLivePriceBySymbol((prev) => ({
              ...prev,
              [tickSymbol]: price
            }));

            setCandles1mBySymbol((previous) => {
              const previousCandles = previous[tickSymbol] ?? [];
              const bucketMs = 60 * 1000;
              const tickTime = new Date(message.tick.time).getTime();
              if (Number.isNaN(tickTime)) return previous;

              const bucketStartMs = Math.floor(tickTime / bucketMs) * bucketMs;
              const currentBucketIso = new Date(bucketStartMs).toISOString();

              const next = [...previousCandles];

              if (next.length === 0) {
                 // Allow creating first candle (this happens during fresh restart)
                 next.push({
                   bucket: currentBucketIso,
                   open: price,
                   high: price,
                   low: price,
                   close: price,
                   volume: volume
                 });
              } else {
                 const lastCandle = next[next.length - 1];
                 const lastCandleTime = new Date(lastCandle.bucket).getTime();
                 
                 if (bucketStartMs === lastCandleTime) {
                    const updatedCandle = { ...lastCandle };
                    updatedCandle.high = Math.max(updatedCandle.high, price);
                    updatedCandle.low = Math.min(updatedCandle.low, price);
                    updatedCandle.close = price;
                    updatedCandle.volume += volume;
                    next[next.length - 1] = updatedCandle;
                 } else if (bucketStartMs > lastCandleTime) {
                    next.push({
                      bucket: currentBucketIso,
                      open: price,
                      high: price,
                      low: price,
                      close: price,
                      volume: volume
                    });
                 }
              }

              return {
                ...previous,
                [tickSymbol]: next,
              };
            });
            return;
          }

          if (message.type === "simulation_state" && message.state?.status) {
            const stateSymbol = message.state.symbol;
            if (!stateSymbol) return;

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
        if (!active) return;
        setSocketStatus("error");
      };

      socket.onclose = (event) => {
        if (!active) return;
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
      if (reconnectTimeout !== null) window.clearTimeout(reconnectTimeout);
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        socket.close();
      }
    };
  }, []);

  // Update Simulation Speed
  const updateSimulationSpeed = async (nextSpeed) => {
    // Optimistic update
    setSpeedBySymbol((prev) => {
       const next = {...prev};
       for (const sym of availableSymbols) {
           next[sym] = nextSpeed;
       }
       return next;
    });
    setErrorMessage("");

    try {
      const payload = await fetchJsonWithTimeout(
        `/api/market/simulation/speed?speed=${encodeURIComponent(nextSpeed)}`,
        { method: "POST" },
        10000,
      );
      const states = Array.isArray(payload.states) ? payload.states : [];

      if (states.length) {
        setStatusBySymbol((previous) => {
          const next = { ...previous };
          for (const state of states) {
            if (state?.symbol) next[state.symbol] = state.status ?? "stopped";
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

  const runGlobalSimulationAction = async (action) => {
    if (!action) return;
    if (globalBusyAction) return;

    setGlobalBusyAction(action);
    setGlobalSimulationError("");

    try {
      // On restart, clear all data first
      if (action === "restart") {
        setIsInitializing(true);
        setCandles1mBySymbol({});
        setLivePriceBySymbol({});
        setStatusBySymbol({});
        setLastTickTimeBySymbol({});
        // Small delay to ensure state updates
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const payload = await fetchJsonWithTimeout(
        `/api/market/simulation/${action}`,
        { method: "POST" },
        15000,
      );
      const states = Array.isArray(payload.states) ? payload.states : [];

      if (states.length) {
        setStatusBySymbol((previous) => {
          const next = { ...previous };
          for (const state of states) {
            if (state?.symbol) next[state.symbol] = state.status ?? "stopped";
          }
          return next;
        });
      }

      // After restart, resync full dataset from API so charts are always consistent.
      if (action === "restart") {
        const symbolsToRefresh = availableSymbols.length
          ? availableSymbols
          : selectableAssets.map((asset) => asset.symbol);

        const refreshed = await Promise.all(
          symbolsToRefresh.map(async (currentSymbol) => {
            try {
              const [fetchedOhlcv, status] = await Promise.all([
                fetchJsonWithTimeout(`/api/market/ohlcv?symbol=${encodeURIComponent(currentSymbol)}&limit=${MAX_TICKS}`, {}, 10000),
                fetchJsonWithTimeout(`/api/market/simulation/${encodeURIComponent(currentSymbol)}/status`, {}, 10000),
              ]);
              const candles = Array.isArray(fetchedOhlcv) ? fetchedOhlcv : [];
              const initialLivePrice = candles.length > 0 ? candles[candles.length - 1].close : null;

              return {
                symbol: currentSymbol,
                candles,
                initialLivePrice,
                status,
              };
            } catch {
              return null;
            }
          }),
        );

        const validRows = refreshed.filter(Boolean);
        if (validRows.length) {
          const nextCandlesBySymbol = {};
          const nextLivePriceBySymbol = {};
          const nextStatusBySymbol = {};
          const nextSpeedBySymbol = {};

          for (const item of validRows) {
            nextCandlesBySymbol[item.symbol] = item.candles;
            if (item.initialLivePrice !== null) {
              nextLivePriceBySymbol[item.symbol] = item.initialLivePrice;
            }
            nextStatusBySymbol[item.symbol] = item.status.status ?? "stopped";
            if (typeof item.status.speed_multiplier === "number") {
              nextSpeedBySymbol[item.symbol] = item.status.speed_multiplier;
            }
          }

          setCandles1mBySymbol(nextCandlesBySymbol);
          setLivePriceBySymbol((prev) => ({ ...prev, ...nextLivePriceBySymbol }));
          setStatusBySymbol(nextStatusBySymbol);
          setSpeedBySymbol(nextSpeedBySymbol);
        }
      }

    } catch (error) {
      setGlobalSimulationError(error.message || "Simulation command failed");
    } finally {
      if (action === "restart") {
        setIsInitializing(false);
      }
      setGlobalBusyAction("");
    }
  };

  // Predictions
  const [predictions, setPredictions] = useState(() => getFallbackPredictions(selectedAsset.symbol));

  useEffect(() => {
    let active = true;
    const fetchPredictions = async () => {
      try {
        const response = await fetch(`/api/predictions/all/${selectedAsset.symbol}`);
        if (!response.ok) return;
        const data = await response.json();
        if (active && data.predictions) {
          setPredictions(data.predictions);
        }
      } catch (err) {
        // preserve fallback if offline
      }
    };
    
    fetchPredictions();
    const timer = setInterval(fetchPredictions, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [selectedAsset.symbol]);

  // Derived Values
  const candles1m = candles1mBySymbol[selectedAsset.symbol] ?? [];
  const livePrice = livePriceBySymbol[selectedAsset.symbol] ?? selectedAsset.basePrice;
  const simulationStatus = statusBySymbol[selectedAsset.symbol] ?? "loading";
  const speedMultiplier = speedBySymbol[selectedAsset.symbol] ?? 1;
  const lastTickTime = lastTickTimeBySymbol[selectedAsset.symbol] ?? null;

  return (
    <div className="app-shell">
      <header className="spa-navbar panel">
        <h1 className="navbar-title">Temporal Market Forecaster</h1>

        <nav className="nav-tabs" aria-label="Primary pages">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`nav-tab ${item.id === activePage ? "active" : ""}`}
              onClick={() => setActivePage(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>

      <div style={{ display: activePage === "dashboard" ? "block" : "none" }}>
        <Dashboard
          assets={selectableAssets}
          selectedAsset={selectedAsset}
          onSymbolChange={setSelectedSymbol}
          candles1m={candles1m}
          livePrice={livePrice}
          simulationStatus={simulationStatus}
          speedMultiplier={speedMultiplier}
          socketStatus={socketStatus}
          errorMessage={errorMessage}
          isInitializing={isInitializing}
          predictions={predictions}
          lastTickTime={lastTickTime}
          simulationControls={{
            busyAction: globalBusyAction,
            errorMessage: globalSimulationError,
            runAction: runGlobalSimulationAction,
            updateSpeed: updateSimulationSpeed,
          }}
        />
      </div>

      <div style={{ display: activePage === "charts" ? "block" : "none" }}>
        <ChartsPage
          assets={selectableAssets}
          selectedAsset={selectedAsset}
          onSymbolChange={setSelectedSymbol}
          candles1m={candles1m}
          livePrice={livePrice}
          simulationStatus={simulationStatus}
          speedMultiplier={speedMultiplier}
          socketStatus={socketStatus}
          errorMessage={errorMessage}
          isInitializing={isInitializing}
          lastTickTime={lastTickTime}
          simulationControls={{
            busyAction: globalBusyAction,
            errorMessage: globalSimulationError,
            runAction: runGlobalSimulationAction,
            updateSpeed: updateSimulationSpeed,
          }}
        />
      </div>

      <div style={{ display: activePage === "ml" ? "block" : "none" }}>
        <MlPredictionsPage
          selectedAsset={selectedAsset}
          predictions={predictions}
        />
      </div>

      <div style={{ display: activePage === "benchmark" ? "block" : "none" }}>
        <BenchmarkPage
          selectedAsset={selectedAsset}
          simulationControls={{
            busyAction: globalBusyAction,
            errorMessage: globalSimulationError,
            runAction: runGlobalSimulationAction,
          }}
        />
      </div>
    </div>
  );
}
