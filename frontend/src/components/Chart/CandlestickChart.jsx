export default function CandlestickChart({ data, height = 280 }) {
  if (!data || data.length === 0) {
    return (
      <div className="chart-wrap chart-empty" style={{ height }}>
        No tick data available for this symbol.
      </div>
    );
  }

  const width = 960;
  const padding = { top: 16, right: 12, bottom: 30, left: 54 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  const lows = data.map((point) => point.low);
  const highs = data.map((point) => point.high);
  const minPrice = Math.min(...lows);
  const maxPrice = Math.max(...highs);
  const range = maxPrice - minPrice || 1;

  const y = (price) =>
    padding.top + innerHeight - ((price - minPrice) / range) * innerHeight;
  const x = (index) => padding.left + (index / (data.length - 1 || 1)) * innerWidth;
  const candleWidth = Math.max(4, innerWidth / data.length - 3);

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg" role="img" aria-label="Dummy candlestick chart">
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
          x2={width - padding.right}
          y1={y(data[data.length - 1].close)}
          y2={y(data[data.length - 1].close)}
          className="last-price-line"
        />
      </svg>
    </div>
  );
}
