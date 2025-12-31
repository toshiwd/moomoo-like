import { useEffect, useRef } from "react";
import { createChart } from "lightweight-charts";

export default function DetailChart({
  candles,
  volume
}: {
  candles: { time: number; open: number; high: number; low: number; close: number }[];
  volume: { time: number; value: number }[];
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const candleSeriesRef = useRef<any>(null);
  const volumeSeriesRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current || chartRef.current) return;
    const chart = createChart(containerRef.current, {
      height: containerRef.current.clientHeight,
      width: containerRef.current.clientWidth,
      layout: {
        background: { color: "#0f1628" },
        textColor: "#cbd5f5"
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.06)" },
        horzLines: { color: "rgba(255,255,255,0.06)" }
      },
      rightPriceScale: { visible: true, borderVisible: false },
      timeScale: { borderVisible: false }
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: "#42d392",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#42d392",
      wickDownColor: "#ef4444"
    });

    const volumeSeries = chart.addHistogramSeries({
      priceScaleId: "",
      color: "#4f6dff",
      priceFormat: { type: "volume" },
      scaleMargins: { top: 0.7, bottom: 0 }
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        chart.applyOptions({
          width: Math.floor(entry.contentRect.width),
          height: Math.floor(entry.contentRect.height)
        });
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, []);

  useEffect(() => {
    if (candleSeriesRef.current) {
      candleSeriesRef.current.setData(candles);
    }
    if (volumeSeriesRef.current) {
      volumeSeriesRef.current.setData(volume);
    }
  }, [candles, volume]);

  return <div className="detail-chart-inner" ref={containerRef} />;
}