import PredictionsPanel from "./PredictionsPanel";
import Panel from "../ui/Panel";
import Pill from "../ui/Pill";

import { useState } from "react";

const MODELS = [
  {
    title: "Trend Classifier",
    family: "XGBoost",
    metric: "accuracy",
    status: "Active",
    tone: "positive",
  },
  {
    title: "Volatility Regressor",
    family: "LightGBM",
    metric: "rmse",
    status: "Active",
    tone: "warning",
  },
  {
    title: "Regime Clusterer",
    family: "K-Means (k=3)",
    metric: "silhouette",
    status: "Active",
    tone: "neutral",
  },
  {
    title: "Gap Predictor",
    family: "XGBoost Multi-Class",
    metric: "accuracy",
    status: "Active",
    tone: "negative",
  },
];

export default function MlPredictionsPage({ selectedAsset, predictions }) {
  const [isTraining, setIsTraining] = useState(false);
  const [trainingStatus, setTrainingStatus] = useState("");

  const handleTrainModels = async () => {
    setIsTraining(true);
    setTrainingStatus("Training models in database...");
    try {
      const response = await fetch("/api/predictions/train", { method: "POST" });
      if (response.ok) {
        setTrainingStatus("Training complete!");
      } else {
        setTrainingStatus("Training failed.");
      }
    } catch (e) {
      setTrainingStatus("Error triggering training.");
    } finally {
      setIsTraining(false);
      setTimeout(() => setTrainingStatus(""), 3000);
    }
  };

  return (
    <main className="page-shell">
      <header className="section-intro panel" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <p className="eyebrow">ML Predictions</p>
          <h2 className="headline">Model Outputs For {selectedAsset.symbol}</h2>
          <p className="subline">
            Live machine learning inference driven natively via PostgresML on the connected database.
          </p>
        </div>
        <div style={{ textAlign: "right" }}>
          <button 
             className="btn" 
             onClick={handleTrainModels} 
             disabled={isTraining}
             style={{ padding: "0.5rem 1.5rem", borderRadius: "0.375rem", background: "var(--brand-primary)", color: "white", cursor: "pointer", border: "none" }}
          >
            {isTraining ? "Training..." : "Train Models"}
          </button>
          {trainingStatus && <p style={{ fontSize: "0.8rad", marginTop: "0.25rem", color: "var(--color-text-muted)" }}>{trainingStatus}</p>}
        </div>
      </header>

      <section className="content-grid">
        <PredictionsPanel
          symbol={selectedAsset.symbol}
          regime={selectedAsset.regime}
          predictions={predictions}
        />

        <Panel title="Model Registry" subtitle="PostgresML Registered Models">
          <div className="model-registry">
            {MODELS.map((model) => (
              <article key={model.title} className="model-row">
                <div>
                  <h3>{model.title}</h3>
                  <p>{model.family}</p>
                </div>
                <div className="model-meta">
                  <Pill tone={model.tone}>{model.metric}</Pill>
                  <span className="model-status">{model.status}</span>
                </div>
              </article>
            ))}
          </div>
        </Panel>
      </section>
    </main>
  );
}
