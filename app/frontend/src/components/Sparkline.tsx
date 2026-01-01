import { useEffect, useMemo, useRef } from "react";
import { createChart, CrosshairMode } from "lightweight-charts";
import { useStore } from "../store";

const MA_COLORS = {
  ma3: "#38bdf8",
  ma10: "#a855f7",
  ma20: "#f59e0b",
  ma30: "#22c55e",
  ma60: "#e11d48"
};

export default function Sparkline({ code }: { code: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const candleRef = useRef<any>(null);
  const maRefs = useRef<Record<string, any>>({});
  const monthly = useStore((state) => state.monthlyCache[code] || []);

  const candleData = useMemo(
    () =>
      monthly.map((row) => ({
        time: row[0],
        open: row[1],
        high: row[2],
        low: row[3],
        close: row[4]
      })),
    [monthly]
  );

  const maSeriesData = useMemo(
    () => ({
      ma3: monthly.map((row) => ({ time: row[0], value: row[5] })),
      ma10: monthly.map((row) => ({ time: row[0], value: row[6] })),
      ma20: monthly.map((row) => ({ time: row[0], value: row[7] })),
      ma30: monthly.map((row) => ({ time: row[0], value: row[8] })),
      ma60: monthly.map((row) => ({ time: row[0], value: row[9] }))
    }),
    [monthly]
  );

  useEffect(() => {
    if (!containerRef.current || chartRef.current) return;
    const chart = createChart(containerRef.current, {
      height: 120,
      width: containerRef.current.clientWidth,
      layout: {
        background: { color: "transparent" },
        textColor: "#7c8698"
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.04)" },
        horzLines: { color: "rgba(255,255,255,0.04)" }
      },
      rightPriceScale: { visible: false },
      leftPriceScale: { visible: false },
      timeScale: { visible: false },
      crosshair: { mode: CrosshairMode.Magnet, vertLine: { visible: false }, horzLine: { visible: false } },
      handleScroll: false,
      handleScale: false
    });

    const series = chart.addCandlestickSeries({
      upColor: "#42d392",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#42d392",
      wickDownColor: "#ef4444"
    });

    const ma3 = chart.addLineSeries({ color: MA_COLORS.ma3, lineWidth: 1, priceLineVisible: false });
    const ma10 = chart.addLineSeries({ color: MA_COLORS.ma10, lineWidth: 1, priceLineVisible: false });
    const ma20 = chart.addLineSeries({ color: MA_COLORS.ma20, lineWidth: 1, priceLineVisible: false });
    const ma30 = chart.addLineSeries({ color: MA_COLORS.ma30, lineWidth: 1, priceLineVisible: false });
    const ma60 = chart.addLineSeries({ color: MA_COLORS.ma60, lineWidth: 1, priceLineVisible: false });

    chartRef.current = chart;
    candleRef.current = series;
    maRefs.current = { ma3, ma10, ma20, ma30, ma60 };

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        chart.applyOptions({ width: Math.floor(entry.contentRect.width) });
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, []);

  useEffect(() => {
    if (!candleRef.current || !candleData.length) return;
    candleRef.current.setData(candleData);
    Object.entries(maRefs.current).forEach(([key, series]) => {
      const points = maSeriesData[key as keyof typeof maSeriesData];
      series.setData(points.filter((point) => point.value !== null));
    });
  }, [candleData, maSeriesData]);

  return <div ref={containerRef} className="sparkline" />;
}