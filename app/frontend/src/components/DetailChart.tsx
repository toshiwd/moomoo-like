import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { createChart } from "lightweight-charts";
import type { Box } from "../store";
import type { DailyPosition, TradeMarker } from "../utils/positions";
import { getBodyRangeFromCandles, getBoxFill, getBoxStroke } from "../utils/boxes";
import PositionOverlay from "./PositionOverlay";

type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

type VolumePoint = {
  time: number;
  value: number;
};

type MaLine = {
  key: string;
  color: string;
  data: { time: number; value: number }[];
  visible: boolean;
  lineWidth: number;
};

export type DetailChartHandle = {
  setVisibleRange: (range: { from: number; to: number } | null) => void;
  fitContent: () => void;
  setCrosshair: (time: number | null) => void;
  clearCrosshair: () => void;
};

type DetailChartProps = {
  candles: Candle[];
  volume: VolumePoint[];
  maLines: MaLine[];
  showVolume: boolean;
  boxes: Box[];
  showBoxes: boolean;
  visibleRange?: { from: number; to: number } | null;
  positionOverlay?: {
    dailyPositions: DailyPosition[];
    tradeMarkers: TradeMarker[];
    showOverlay: boolean;
    showPnL: boolean;
    hoverTime: number | null;
  };
  onCrosshairMove?: (time: number | null) => void;
};

const DetailChart = forwardRef<DetailChartHandle, DetailChartProps>(function DetailChart(
  {
    candles,
    volume,
    maLines,
    showVolume,
    boxes,
    showBoxes,
    visibleRange,
    positionOverlay,
    onCrosshairMove
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const candleSeriesRef = useRef<any>(null);
  const volumeSeriesRef = useRef<any>(null);
  const lineSeriesRef = useRef<any[]>([]);
  const [overlayTargets, setOverlayTargets] = useState<{
    candleSeries: any;
  }>({ candleSeries: null });
  const dataRef = useRef({ candles, volume, maLines, showVolume, boxes, showBoxes });
  const visibleRangeRef = useRef<DetailChartProps["visibleRange"]>(visibleRange);
  const candlesRef = useRef<Candle[]>(candles);
  const boxesRef = useRef<Box[]>(boxes);
  const showBoxesRef = useRef(showBoxes);
  const suppressCrosshairRef = useRef(false);
  const onCrosshairMoveRef = useRef<DetailChartProps["onCrosshairMove"]>(onCrosshairMove);

  const BOX_FILL = getBoxFill();
  const BOX_STROKE = getBoxStroke();

  const findNearestCandle = (time: number) => {
    const items = candlesRef.current;
    if (!items.length) return null;
    let left = 0;
    let right = items.length - 1;
    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const midTime = items[mid].time;
      if (midTime === time) return items[mid];
      if (midTime < time) {
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }
    const lower = items[Math.max(0, Math.min(items.length - 1, right))];
    const upper = items[Math.max(0, Math.min(items.length - 1, left))];
    if (!lower) return upper;
    if (!upper) return lower;
    return Math.abs(time - lower.time) <= Math.abs(upper.time - time) ? lower : upper;
  };

  const drawBoxes = () => {
    const canvas = overlayRef.current;
    const chart = chartRef.current;
    if (!canvas || !chart) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    ctx.clearRect(0, 0, width, height);

    if (!showBoxesRef.current) return;
    const boxesToDraw = boxesRef.current;
    if (!boxesToDraw.length) return;

    const timeScale = chart.timeScale();
    const series = candleSeriesRef.current;
    if (!series) return;
    if (typeof timeScale.timeToCoordinate !== "function") return;
    if (typeof series.priceToCoordinate !== "function") return;

    ctx.fillStyle = BOX_FILL;
    ctx.strokeStyle = BOX_STROKE;
    ctx.lineWidth = 1;

    boxesToDraw.forEach((box) => {
      const x1 = timeScale.timeToCoordinate(box.startTime as any);
      const x2 = timeScale.timeToCoordinate(box.endTime as any);
      const bodyRange = getBodyRangeFromCandles(candlesRef.current, box.startTime, box.endTime);
      const upper = bodyRange?.upper ?? box.upper;
      const lower = bodyRange?.lower ?? box.lower;
      if (!Number.isFinite(upper) || !Number.isFinite(lower)) return;
      const y1 = series.priceToCoordinate(upper);
      const y2 = series.priceToCoordinate(lower);
      if (x1 == null || x2 == null || y1 == null || y2 == null) return;
      const rectX = Math.min(x1, x2);
      const rectY = Math.min(y1, y2);
      const rectW = Math.max(1, Math.abs(x2 - x1));
      const rectH = Math.max(1, Math.abs(y2 - y1));
      ctx.fillRect(rectX, rectY, rectW, rectH);
      ctx.strokeRect(rectX, rectY, rectW, rectH);
    });
  };

  const resizeOverlay = () => {
    const wrapper = wrapperRef.current;
    const canvas = overlayRef.current;
    if (!wrapper || !canvas) return;
    const width = Math.floor(wrapper.clientWidth);
    const height = Math.floor(wrapper.clientHeight);
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    }
    drawBoxes();
  };

  const syncLineSeries = (nextLines: MaLine[]) => {
    const chart = chartRef.current;
    if (!chart) return;
    const current = lineSeriesRef.current;
    if (current.length > nextLines.length) {
      for (let index = nextLines.length; index < current.length; index += 1) {
        chart.removeSeries(current[index]);
      }
      current.length = nextLines.length;
    }
    if (current.length < nextLines.length) {
      for (let index = current.length; index < nextLines.length; index += 1) {
        const line = nextLines[index];
        current.push(
          chart.addLineSeries({
            color: line.color,
            lineWidth: line.lineWidth,
            priceLineVisible: false
          })
        );
      }
    }
  };

  const applyData = (next: typeof dataRef.current) => {
    const chart = chartRef.current;
    if (chart) {
      chart.applyOptions({
        rightPriceScale: {
          scaleMargins: { top: 0.08, bottom: next.showVolume ? 0.25 : 0.12 }
        }
      });
      chart.priceScale("volume").applyOptions({
        scaleMargins: { top: next.showVolume ? 0.82 : 1, bottom: 0 }
      });
      syncLineSeries(next.maLines);
    }
    if (candleSeriesRef.current) {
      candleSeriesRef.current.setData(next.candles);
    }
    if (volumeSeriesRef.current) {
      volumeSeriesRef.current.setData(next.showVolume ? next.volume : []);
      volumeSeriesRef.current.applyOptions({ visible: next.showVolume });
    }
    next.maLines.forEach((line, index) => {
      const series = lineSeriesRef.current[index];
      if (!series) return;
      series.applyOptions({ color: line.color, visible: line.visible, lineWidth: line.lineWidth });
      series.setData(line.data);
    });
    if (chart && next.candles.length && !visibleRangeRef.current) {
      chart.timeScale().fitContent();
    }
    drawBoxes();
  };

  useImperativeHandle(ref, () => ({
    setVisibleRange: (range) => {
      const chart = chartRef.current;
      if (!chart) return;
      if (!range) {
        chart.timeScale().fitContent();
        return;
      }
      chart.timeScale().setVisibleRange(range);
    },
    fitContent: () => {
      chartRef.current?.timeScale().fitContent();
    },
    setCrosshair: (time) => {
      const chart = chartRef.current as any;
      const series = candleSeriesRef.current;
      if (!chart || !series) return;
      const clearCrosshair = chart.clearCrosshairPosition;
      if (time == null) {
        if (typeof clearCrosshair === "function") {
          suppressCrosshairRef.current = true;
          clearCrosshair.call(chart);
        }
        return;
      }
      const nearest = findNearestCandle(time);
      if (!nearest) {
        if (typeof clearCrosshair === "function") {
          suppressCrosshairRef.current = true;
          clearCrosshair.call(chart);
        }
        return;
      }
      const setCrosshairPosition = chart.setCrosshairPosition;
      if (typeof setCrosshairPosition === "function") {
        suppressCrosshairRef.current = true;
        setCrosshairPosition.call(chart, nearest.close, nearest.time, series);
      }
    },
    clearCrosshair: () => {
      const chart = chartRef.current as any;
      if (!chart) return;
      if (typeof chart.clearCrosshairPosition === "function") {
        suppressCrosshairRef.current = true;
        chart.clearCrosshairPosition();
      }
    }
  }));

  useEffect(() => {
    dataRef.current = { candles, volume, maLines, showVolume, boxes, showBoxes };
    candlesRef.current = candles;
    boxesRef.current = boxes;
    showBoxesRef.current = showBoxes;
    applyData(dataRef.current);
  }, [candles, volume, maLines, showVolume, boxes, showBoxes]);

  useEffect(() => {
    visibleRangeRef.current = visibleRange ?? null;
    const chart = chartRef.current;
    if (!chart) return;
    if (!visibleRange) {
      chart.timeScale().fitContent();
      return;
    }
    chart.timeScale().setVisibleRange(visibleRange);
  }, [visibleRange]);

  useEffect(() => {
    onCrosshairMoveRef.current = onCrosshairMove;
  }, [onCrosshairMove]);

  useLayoutEffect(() => {
    if (!containerRef.current || chartRef.current) return;
    const element = containerRef.current;
    let resizeObserver: ResizeObserver | null = null;
    let rafId = 0;

    const init = () => {
      if (chartRef.current) return;
      const width = Math.floor(element.clientWidth);
      const height = Math.floor(element.clientHeight);
      if (width <= 0 || height <= 0) {
        rafId = window.requestAnimationFrame(init);
        return;
      }

      const chart = createChart(element, {
        height,
        width,
        layout: {
          background: { color: "#0f1628" },
          textColor: "#cbd5f5"
        },
        grid: {
          vertLines: { color: "rgba(255,255,255,0.06)" },
          horzLines: { color: "rgba(255,255,255,0.06)" }
        },
        rightPriceScale: {
          visible: true,
          borderVisible: false,
          scaleMargins: { top: 0.08, bottom: 0.25 }
        },
        timeScale: { borderVisible: false }
      });

      const candleSeries = chart.addCandlestickSeries({
        upColor: "#ef4444",
        downColor: "#22c55e",
        borderVisible: false,
        wickUpColor: "#ef4444",
        wickDownColor: "#22c55e"
      });

      const volumeSeries = chart.addHistogramSeries({
        priceScaleId: "volume",
        color: "rgba(79, 109, 255, 0.6)",
        priceFormat: { type: "volume" },
        lastValueVisible: false
      });

      chart.priceScale("volume").applyOptions({
        scaleMargins: { top: 0.82, bottom: 0 },
        visible: false,
        borderVisible: false
      });

      const lineSeries = maLines.map((line) =>
        chart.addLineSeries({
          color: line.color,
          lineWidth: line.lineWidth,
          priceLineVisible: false
        })
      );

      const crosshairHandler = (param: any) => {
        if (suppressCrosshairRef.current) {
          suppressCrosshairRef.current = false;
          return;
        }
        if (!onCrosshairMoveRef.current) return;
        if (!param || !param.time) {
          onCrosshairMoveRef.current(null);
          return;
        }
        if (typeof param.time === "number") {
          onCrosshairMoveRef.current(param.time);
          return;
        }
        if (typeof param.time === "object" && param.time !== null) {
          const { year, month, day } = param.time as { year?: number; month?: number; day?: number };
          if (year && month && day) {
            const timestamp = Math.floor(Date.UTC(year, month - 1, day) / 1000);
            onCrosshairMoveRef.current(timestamp);
            return;
          }
        }
        onCrosshairMoveRef.current(null);
      };

      chart.subscribeCrosshairMove(crosshairHandler);
      const timeScale = chart.timeScale() as any;
      const priceScale = chart.priceScale("right") as any;
      const rangeHandler = () => drawBoxes();
      if (timeScale?.subscribeVisibleLogicalRangeChange) {
        timeScale.subscribeVisibleLogicalRangeChange(rangeHandler);
      }
      if (timeScale?.subscribeVisibleTimeRangeChange) {
        timeScale.subscribeVisibleTimeRangeChange(rangeHandler);
      }
      if (priceScale?.subscribeVisibleLogicalRangeChange) {
        priceScale.subscribeVisibleLogicalRangeChange(rangeHandler);
      }

      chartRef.current = chart;
      candleSeriesRef.current = candleSeries;
      volumeSeriesRef.current = volumeSeries;
      lineSeriesRef.current = lineSeries;
      setOverlayTargets({ candleSeries });

      applyData(dataRef.current);
      resizeOverlay();

      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          chart.applyOptions({
            width: Math.floor(entry.contentRect.width),
            height: Math.floor(entry.contentRect.height)
          });
          resizeOverlay();
        }
      });
      resizeObserver.observe(element);

      return () => {
        chart.unsubscribeCrosshairMove(crosshairHandler);
        if (timeScale?.unsubscribeVisibleLogicalRangeChange) {
          timeScale.unsubscribeVisibleLogicalRangeChange(rangeHandler);
        }
        if (timeScale?.unsubscribeVisibleTimeRangeChange) {
          timeScale.unsubscribeVisibleTimeRangeChange(rangeHandler);
        }
        if (priceScale?.unsubscribeVisibleLogicalRangeChange) {
          priceScale.unsubscribeVisibleLogicalRangeChange(rangeHandler);
        }
      };
    };

    const teardown = init();

    return () => {
      if (teardown) teardown();
      if (rafId) window.cancelAnimationFrame(rafId);
      if (resizeObserver) resizeObserver.disconnect();
      if (chartRef.current) {
        chartRef.current.remove();
      }
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      lineSeriesRef.current = [];
      setOverlayTargets({ candleSeries: null });
    };
  }, []);

  return (
    <div className="detail-chart-wrapper" ref={wrapperRef}>
      <div className="detail-chart-inner" ref={containerRef} />
      <canvas className="detail-chart-overlay" ref={overlayRef} />
      {positionOverlay && (positionOverlay.showOverlay || positionOverlay.showPnL) && (
        <PositionOverlay
          candleSeries={overlayTargets.candleSeries}
          dailyPositions={positionOverlay.dailyPositions}
          tradeMarkers={positionOverlay.tradeMarkers}
          showOverlay={positionOverlay.showOverlay}
          showPnL={positionOverlay.showPnL}
          hoverTime={positionOverlay.hoverTime}
        />
      )}
    </div>
  );
});

export default DetailChart;
