import { useEffect, useRef } from "react";
import { createChart } from "lightweight-charts";

export default function DetailChart({
  candles,
  volume,
  ma7,
  ma20,
  ma60,
  maVisible
}: {
  candles: { time: number; open: number; high: number; low: number; close: number }[];
  volume: { time: number; value: number }[];
  ma7: { time: number; value: number }[];
  ma20: { time: number; value: number }[];
  ma60: { time: number; value: number }[];
  maVisible: { ma7: boolean; ma20: boolean; ma60: boolean };
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const candleSeriesRef = useRef<any>(null);
  const volumeSeriesRef = useRef<any>(null);
  const maRefs = useRef<Record<string, any>>({});

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

    const ma7Series = chart.addLineSeries({ color: "#38bdf8", lineWidth: 2, priceLineVisible: false });
    const ma20Series = chart.addLineSeries({ color: "#f59e0b", lineWidth: 2, priceLineVisible: false });
    const ma60Series = chart.addLineSeries({ color: "#22c55e", lineWidth: 2, priceLineVisible: false });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    maRefs.current = {
      ma7: ma7Series,
      ma20: ma20Series,
      ma60: ma60Series
    };

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
    if (maRefs.current.ma7) maRefs.current.ma7.setData(ma7);
    if (maRefs.current.ma20) maRefs.current.ma20.setData(ma20);
    if (maRefs.current.ma60) maRefs.current.ma60.setData(ma60);
  }, [candles, volume, ma7, ma20, ma60]);

  useEffect(() => {
    if (!maRefs.current) return;
    maRefs.current.ma7?.applyOptions({ visible: maVisible.ma7 });
    maRefs.current.ma20?.applyOptions({ visible: maVisible.ma20 });
    maRefs.current.ma60?.applyOptions({ visible: maVisible.ma60 });
  }, [maVisible]);

  return <div className="detail-chart-inner" ref={containerRef} />;
}