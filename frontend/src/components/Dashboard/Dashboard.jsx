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

export default function Dashboard({
  assets,
  onSymbolChange,
  selectedAsset,
  livePrice,
  candles,
  predictions,
  simulationControls,
}) {
  const movement = formatDelta(selectedAsset.basePrice, livePrice);
  const movementTone = movement.change >= 0 ? "positive" : "negative";
  const busyAction = simulationControls?.busyAction ?? "";

  return (
    <main className="page-shell">
      <header className="section-intro panel">
        <p className="eyebrow">Dashboard</p>
        <h2 className="headline">Portfolio Snapshot For {selectedAsset.symbol}</h2>
        <p className="subline">
          Live mock pricing with reusable cards, chart, predictions, and watchlist.
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

        {simulationControls?.errorMessage ? (
          <p className="subline simulation-error">{simulationControls.errorMessage}</p>
        ) : null}
      </header>

      <section className="stats-grid">
        <MetricCard
          label="Live Price"
          value={formatPrice(livePrice)}
          delta={`${movement.change >= 0 ? "+" : ""}${movement.change} (${movement.percent}%)`}
          tone={movementTone}
          helper={`${selectedAsset.symbol} · ${selectedAsset.sector}`}
        />
        <MetricCard
          label="Predicted Next Candle"
          value="Bullish"
          delta="74% confidence"
          tone="positive"
          helper="XGBoost Classification"
        />
        <MetricCard
          label="Volatility"
          value="$2.84"
          delta="Expected move"
          tone="warning"
          helper="LightGBM Regression"
        />
        <MetricCard
          label="Regime"
          value={selectedAsset.regime}
          delta="Per symbol"
          tone="neutral"
          helper="K-Means (k=3)"
        />
      </section>

      <section className="content-grid">
        <Panel
          title={`${selectedAsset.symbol} Price Action`}
          subtitle={`${selectedAsset.name} · ${selectedAsset.marketCap} market cap`}
          right={<Pill tone={movementTone}>{movement.change >= 0 ? "Uptrend" : "Pullback"}</Pill>}
        >
          <CandlestickChart data={candles} />
        </Panel>

        <PredictionsPanel
          symbol={selectedAsset.symbol}
          regime={selectedAsset.regime}
          predictions={predictions}
        />
      </section>

      <section className="bottom-grid">
        <Panel title="Watchlist" subtitle="Mock symbols for demo navigation">
          <div className="watchlist-table">
            {assets.map((asset) => {
              const isActive = asset.symbol === selectedAsset.symbol;
              const previewDelta = formatDelta(asset.basePrice, asset.basePrice * 1.004);

              return (
                <button
                  key={asset.symbol}
                  className={`watchlist-row ${isActive ? "active" : ""}`}
                  onClick={() => onSymbolChange(asset.symbol)}
                >
                  <span>{asset.symbol}</span>
                  <span>{asset.sector}</span>
                  <span>{formatPrice(asset.basePrice)}</span>
                  <span className={previewDelta.change >= 0 ? "positive" : "negative"}>
                    {previewDelta.change >= 0 ? "+" : ""}
                    {previewDelta.percent}%
                  </span>
                </button>
              );
            })}
          </div>
        </Panel>

        <Panel title="Activity Feed" subtitle="Placeholder updates for UI testing">
          <ul className="activity-feed">
            <li>
              <span className="activity-time">09:35</span>
              <p>{selectedAsset.symbol} mock WebSocket tick received.</p>
            </li>
            <li>
              <span className="activity-time">09:34</span>
              <p>Predictions recalculated from dummy feature vector.</p>
            </li>
            <li>
              <span className="activity-time">09:31</span>
              <p>Continuous aggregate refresh simulated.</p>
            </li>
          </ul>
        </Panel>
      </section>
    </main>
  );
}
