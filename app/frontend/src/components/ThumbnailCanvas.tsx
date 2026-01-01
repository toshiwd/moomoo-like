import { useEffect, useMemo, useRef } from "react";
import { BarsPayload, Box, MaSetting, useStore } from "../store";
import { getBodyRangeFromBars, getBoxFill, getBoxStroke } from "../utils/boxes";

const COLORS = {
  up: "#ef4444",
  down: "#22c55e"
};

const MIN_HEIGHT = 80;
const MAX_BARS = 30;
const BOX_FILL = getBoxFill();
const BOX_STROKE = getBoxStroke();

function buildMaMap(bars: number[][], period: number) {
  const map = new Map<number, number>();
  if (period <= 1) {
    bars.forEach((bar) => {
      map.set(bar[0], Number(bar[4]));
    });
    return map;
  }
  let sum = 0;
  for (let i = 0; i < bars.length; i += 1) {
    const close = Number(bars[i][4]);
    sum += close;
    if (i >= period) {
      sum -= Number(bars[i - period][4]);
    }
    if (i >= period - 1) {
      map.set(bars[i][0], sum / period);
    }
  }
  return map;
}

function drawChart(
  canvas: HTMLCanvasElement,
  payload: BarsPayload,
  boxes: Box[],
  showBoxes: boolean,
  maSettings: MaSetting[],
  width: number,
  height: number
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const allBars = payload.bars;
  const bars = allBars.slice(-MAX_BARS);
  if (!bars.length) {
    ctx.clearRect(0, 0, width, height);
    return;
  }

  const pad = 6;
  const hi = Math.max(...bars.map((b) => b[2]));
  const lo = Math.min(...bars.map((b) => b[3]));
  let min = lo;
  let max = hi;

  const activeMaSettings = maSettings.filter((setting) => setting.visible);
  const maMaps = activeMaSettings.map((setting) => ({
    setting,
    map: buildMaMap(allBars, setting.period)
  }));

  bars.forEach((bar) => {
    const time = bar[0];
    maMaps.forEach(({ map }) => {
      const value = map.get(time);
      if (value == null || Number.isNaN(value)) return;
      min = Math.min(min, value);
      max = Math.max(max, value);
    });
  });

  const range = Math.max(1e-6, max - min);

  const toY = (value: number) => {
    return pad + (height - pad * 2) * (1 - (value - min) / range);
  };

  ctx.clearRect(0, 0, width, height);
  ctx.lineWidth = 1;

  const step = width / bars.length;
  const candleWidth = Math.max(1, Math.min(6, step * 0.6));

  bars.forEach((bar, index) => {
    const [t, o, h, l, c] = bar;
    const x = step * index + step / 2;
    const color = c >= o ? COLORS.up : COLORS.down;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;

    const yHigh = toY(h);
    const yLow = toY(l);
    const yOpen = toY(o);
    const yClose = toY(c);

    ctx.beginPath();
    ctx.moveTo(x, yHigh);
    ctx.lineTo(x, yLow);
    ctx.stroke();

    const rectY = Math.min(yOpen, yClose);
    const rectH = Math.max(1, Math.abs(yClose - yOpen));
    ctx.fillRect(x - candleWidth / 2, rectY, candleWidth, rectH);
  });

  if (showBoxes && boxes.length) {
    const times = bars.map((bar) => bar[0]);
    const findStart = (time: number) => {
      let left = 0;
      let right = times.length - 1;
      let result = -1;
      while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        if (times[mid] >= time) {
          result = mid;
          right = mid - 1;
        } else {
          left = mid + 1;
        }
      }
      return result;
    };
    const findEnd = (time: number) => {
      let left = 0;
      let right = times.length - 1;
      let result = -1;
      while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        if (times[mid] <= time) {
          result = mid;
          left = mid + 1;
        } else {
          right = mid - 1;
        }
      }
      return result;
    };

    ctx.save();
    ctx.fillStyle = BOX_FILL;
    ctx.strokeStyle = BOX_STROKE;
    ctx.lineWidth = 1;
    boxes.forEach((box) => {
      const startIdx = findStart(box.startTime);
      const endIdx = findEnd(box.endTime);
      if (startIdx < 0 || endIdx < 0 || endIdx < startIdx) return;
      const bodyRange = getBodyRangeFromBars(bars, box.startTime, box.endTime);
      const upper = bodyRange?.upper ?? box.upper;
      const lower = bodyRange?.lower ?? box.lower;
      const x1 = step * startIdx;
      const x2 = step * (endIdx + 1);
      const y1 = toY(upper);
      const y2 = toY(lower);
      const rectX = x1;
      const rectY = Math.min(y1, y2);
      const rectW = Math.max(1, x2 - x1);
      const rectH = Math.max(1, Math.abs(y2 - y1));
      ctx.fillRect(rectX, rectY, rectW, rectH);
      ctx.strokeRect(rectX, rectY, rectW, rectH);
    });
    ctx.restore();
  }

  const drawMa = (map: Map<number, number>, setting: MaSetting) => {
    ctx.strokeStyle = setting.color;
    ctx.lineWidth = Math.max(1, setting.lineWidth);
    ctx.beginPath();
    let started = false;
    bars.forEach((bar, index) => {
      const t = bar[0];
      const value = map.get(t);
      if (value === undefined) {
        return;
      }
      const x = step * index + step / 2;
      const y = toY(value);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    });
    if (started) ctx.stroke();
  };

  maMaps.forEach(({ map, setting }) => {
    drawMa(map, setting);
  });
}

export default function ThumbnailCanvas({
  payload,
  boxes,
  showBoxes,
  timeframe
}: {
  payload: BarsPayload;
  boxes: Box[];
  showBoxes: boolean;
  timeframe: "daily" | "weekly" | "monthly";
}) {
  const maSettings = useStore((state) =>
    timeframe === "daily"
      ? state.maSettings.daily
      : timeframe === "weekly"
      ? state.maSettings.weekly
      : state.maSettings.monthly
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastKeyRef = useRef<string>("");

  const renderKey = useMemo(() => {
    const bars = payload.bars;
    const last = bars[bars.length - 1];
    const firstBox = boxes[0];
    const settingsKey = maSettings
      .map((setting) => `${setting.period}-${setting.visible}-${setting.color}-${setting.lineWidth}`)
      .join("|");
    return `${bars.length}-${bars[0]?.[0]}-${last?.[0]}-${last?.[4]}-${boxes.length}-${firstBox?.startTime ?? "none"}-${showBoxes}-${settingsKey}`;
  }, [payload, boxes, showBoxes, maSettings]);

  useEffect(() => {
    if (!containerRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const resize = () => {
      const width = Math.floor(containerRef.current?.clientWidth || 0);
      const height = Math.max(MIN_HEIGHT, Math.floor(containerRef.current?.clientHeight || 0));
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      }
      drawChart(canvas, payload, boxes, showBoxes, maSettings, width, height);
    };

    resize();
    const observer = new ResizeObserver(() => resize());
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [payload, boxes, showBoxes, maSettings, renderKey]);

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;
    if (lastKeyRef.current === renderKey) return;
    lastKeyRef.current = renderKey;
    drawChart(
      canvasRef.current,
      payload,
      boxes,
      showBoxes,
      maSettings,
      canvasRef.current.clientWidth,
      Math.max(MIN_HEIGHT, canvasRef.current.clientHeight)
    );
  }, [payload, boxes, showBoxes, maSettings, renderKey]);

  return (
    <div ref={containerRef} className="thumb-canvas">
      <canvas ref={canvasRef} />
    </div>
  );
}
