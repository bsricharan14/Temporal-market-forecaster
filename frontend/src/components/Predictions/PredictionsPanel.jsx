import Panel from "../ui/Panel";
import Pill from "../ui/Pill";

export default function PredictionsPanel({ symbol, regime, predictions }) {
  return (
    <Panel
      title="Model Predictions"
      subtitle={`${symbol} live outputs`}
      right={<Pill tone="neutral">{regime}</Pill>}
    >
      <div className="predictions-stack">
        {predictions.map((prediction) => (
          <article key={prediction.title} className="prediction-card">
            <div className="prediction-header">
              <h3>{prediction.title}</h3>
              <Pill tone={prediction.tone}>{prediction.value}</Pill>
            </div>
            <p className="prediction-model">{prediction.model}</p>
            <p className="prediction-explanation">{prediction.explanation}</p>
            <p className="prediction-note">{prediction.note}</p>
            <p className="prediction-terms">{prediction.terms}</p>
            <div className="confidence-row">
              <span>Confidence</span>
              <strong>{prediction.confidence}%</strong>
            </div>
            <div className="confidence-bar">
              <span
                style={{ width: `${prediction.confidence}%` }}
                className={`confidence-fill ${prediction.tone}`}
              />
            </div>
          </article>
        ))}
      </div>
    </Panel>
  );
}
