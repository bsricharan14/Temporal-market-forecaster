function formatXAxisLabel(value, timeframeLabel) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }

  if (timeframeLabel === "1d") {
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }

  if (timeframeLabel === "1m") {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function CandlestickChart({ data, height = 280, timeframeLabel = "1m" }) {
  if (!data || data.length === 0) {
    return (
      <div className="chart-wrap chart-empty" style={{ height }}>
        No tick data available for this symbol.
      </div>
    );
  }

  const width = 960;
  const padding = { top: 16, right: 74, bottom: 38, left: 54 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  const lows = data.map((point) => point.low);
  const highs = data.map((point) => point.high);
  const minPrice = Math.min(...lows);
  const maxPrice = Math.max(...highs);
  const range = maxPrice - minPrice || 1;

  const y = (price) =>
    padding.top + innerHeight - ((price - minPrice) / range) * innerHeight;
  const candleWidth = Math.max(2, innerWidth / Math.max(1, data.length));
  const x = (index) => padding.left + candleWidth * index + candleWidth / 2;
  const lastClose = data[data.length - 1].close;
  const xLabelIndexes = [0, Math.floor(data.length / 3), Math.floor((data.length * 2) / 3), data.length - 1]
    .filter((idx, i, arr) => arr.indexOf(idx) === i);

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg" role="img" aria-label="Live candlestick chart">
        {[0, 1, 2, 3, 4].map((mark) => {
          const price = minPrice + (range * mark) / 4;
          const yAxis = y(price);

          return (
            <g key={mark}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={yAxis}
                y2={yAxis}
                className="chart-grid-line"
              />
              <text x={padding.left - 8} y={yAxis + 4} textAnchor="end" className="chart-axis-label">
                {price.toFixed(2)}
              </text>
            </g>
          );
        })}

        {xLabelIndexes.map((index) => (
          <g key={`x-${index}`}>
            <line
              x1={x(index)}
              x2={x(index)}
              y1={height - padding.bottom}
              y2={height - padding.bottom + 4}
              className="chart-grid-line"
            />
            <text
              x={x(index)}
              y={height - 8}
              textAnchor="middle"
              className="chart-axis-label"
            >
              {formatXAxisLabel(data[index].bucket, timeframeLabel)}
            </text>
          </g>
        ))}

        {data.map((point, index) => {
          const bullish = point.close >= point.open;
          const top = y(Math.max(point.open, point.close));
          const bottom = y(Math.min(point.open, point.close));
          const bodyHeight = Math.max(1.5, bottom - top);

          return (
            <g key={`${point.index}-${index}`}>
              <line
                x1={x(index)}
                x2={x(index)}
                y1={y(point.high)}
                y2={y(point.low)}
                className={bullish ? "wick-positive" : "wick-negative"}
              />
              <rect
                x={x(index) - candleWidth / 2}
                y={top}
                width={candleWidth}
                height={bodyHeight}
                className={bullish ? "candle-positive" : "candle-negative"}
              />
            </g>
          );
        })}

        <line
          x1={padding.left}
          x2={width - padding.right + 2}
          y1={y(lastClose)}
          y2={y(lastClose)}
          className="last-price-line"
        />

        <rect
          x={width - padding.right + 6}
          y={y(lastClose) - 10}
          rx={5}
          ry={5}
          width={58}
          height={20}
          className="last-price-tag-bg"
        />
        <text
          x={width - padding.right + 35}
          y={y(lastClose) + 4}
          textAnchor="middle"
          className="last-price-tag-text"
        >
          {lastClose.toFixed(2)}
        </text>
      </svg>
    </div>
  );
}
