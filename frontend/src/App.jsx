import { useEffect, useMemo, useState } from "react";
import Dashboard from "./components/Dashboard/Dashboard";
import ChartsPage from "./components/Chart/ChartsPage";
import MlPredictionsPage from "./components/Predictions/MlPredictionsPage";
import BenchmarkPage from "./components/Benchmark/BenchmarkPage";

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

function buildCandles(startPrice, count = 56) {
  let current = startPrice;
  return Array.from({ length: count }, (_, index) => {
    const open = current;
    const swing = (Math.random() - 0.48) * (startPrice * 0.008);
    const close = Math.max(1, open + swing);
    const high = Math.max(open, close) + Math.random() * (startPrice * 0.004);
    const low = Math.min(open, close) - Math.random() * (startPrice * 0.004);
    const volume = 1200 + Math.round(Math.random() * 4200);
    current = close;
    return { index, open, high, low, close, volume };
  });
}

function buildPredictions(symbol) {
  return [
    {
      title: "Next Candle Direction",
      model: "XGBoost Classifier",
      value: "Bullish",
      confidence: 74,
      tone: "positive",
      note: `${symbol} momentum is still above the short-term mean.`,
    },
    {
      title: "Volatility Band",
      model: "LightGBM Regressor",
      value: "$2.84",
      confidence: 66,
      tone: "warning",
      note: "Expected hourly move range around the current mean.",
    },
    {
      title: "Regime State",
      model: "K-Means (k=3)",
      value: "Per-Symbol",
      confidence: 68,
      tone: "neutral",
      note: "Clustering runs on this symbol only, not market-wide.",
    },
  ];
}

export default function App() {
  const [activePage, setActivePage] = useState("dashboard");
  const [selectedSymbol, setSelectedSymbol] = useState(ASSETS[0].symbol);
  const [availableSymbols, setAvailableSymbols] = useState([]);
  const [globalBusyAction, setGlobalBusyAction] = useState("");
  const [globalSimulationError, setGlobalSimulationError] = useState("");

  const selectableAssets = useMemo(() => {
    if (!availableSymbols.length) {
      return ASSETS;
    }
    const filtered = ASSETS.filter((asset) => availableSymbols.includes(asset.symbol));
    return filtered.length ? filtered : ASSETS;
  }, [availableSymbols]);

  const selectedAsset = useMemo(
    () => selectableAssets.find((asset) => asset.symbol === selectedSymbol) ?? selectableAssets[0],
    [selectedSymbol, selectableAssets],
  );

  useEffect(() => {
    let active = true;

    const loadSymbols = async () => {
      try {
        const response = await fetch("/api/market/simulation/symbols");
        if (!response.ok) {
          return;
        }

        const payload = await response.json();
        if (!active) {
          return;
        }
        setAvailableSymbols(Array.isArray(payload.symbols) ? payload.symbols : []);
      } catch {
        // Keep fallback asset list when API is unavailable.
      }
    };

    loadSymbols();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectableAssets.find((asset) => asset.symbol === selectedSymbol)) {
      setSelectedSymbol(selectableAssets[0].symbol);
    }
  }, [selectableAssets, selectedSymbol]);

  const [livePrice, setLivePrice] = useState(selectedAsset.basePrice);

  useEffect(() => {
    setLivePrice(selectedAsset.basePrice);
  }, [selectedAsset]);

  useEffect(() => {
    const timer = setInterval(() => {
      setLivePrice((previous) => {
        const drift = (Math.random() - 0.5) * selectedAsset.basePrice * 0.0012;
        return Math.max(1, Number((previous + drift).toFixed(2)));
      });
    }, 1200);

    return () => clearInterval(timer);
  }, [selectedAsset]);

  const candles = useMemo(
    () => buildCandles(selectedAsset.basePrice),
    [selectedAsset.basePrice],
  );

  const predictions = useMemo(
    () => buildPredictions(selectedAsset.symbol),
    [selectedAsset.symbol],
  );

  const runGlobalSimulationAction = async (action) => {
    if (!action) {
      return;
    }

    setGlobalBusyAction(action);
    setGlobalSimulationError("");

    try {
      const response = await fetch(`/api/market/simulation/${action}`, { method: "POST" });
      if (!response.ok) {
        throw new Error(`Unable to ${action} simulation`);
      }
    } catch (error) {
      setGlobalSimulationError(error.message || "Simulation command failed");
    } finally {
      setGlobalBusyAction("");
    }
  };

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
          assets={ASSETS}
          selectedAsset={selectedAsset}
          onSymbolChange={setSelectedSymbol}
          livePrice={livePrice}
          candles={candles}
          predictions={predictions}
          simulationControls={{
            busyAction: globalBusyAction,
            errorMessage: globalSimulationError,
            runAction: runGlobalSimulationAction,
          }}
        />
      </div>

      <div style={{ display: activePage === "charts" ? "block" : "none" }}>
        <ChartsPage
          selectedAsset={selectedAsset}
          simulationControls={{
            busyAction: globalBusyAction,
            errorMessage: globalSimulationError,
            runAction: runGlobalSimulationAction,
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
