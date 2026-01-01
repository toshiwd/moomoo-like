import type { Box } from "../store";

type CandleLike = {
  time: number;
  open: number;
  close: number;
};

export const getBodyRangeFromCandles = (
  candles: CandleLike[],
  startTime: number,
  endTime: number
) => {
  let upper = -Infinity;
  let lower = Infinity;
  for (const candle of candles) {
    if (candle.time < startTime || candle.time > endTime) continue;
    const bodyHigh = Math.max(candle.open, candle.close);
    const bodyLow = Math.min(candle.open, candle.close);
    if (bodyHigh > upper) upper = bodyHigh;
    if (bodyLow < lower) lower = bodyLow;
  }
  if (!Number.isFinite(upper) || !Number.isFinite(lower)) return null;
  return { upper, lower };
};

export const getBodyRangeFromBars = (bars: number[][], startTime: number, endTime: number) => {
  let upper = -Infinity;
  let lower = Infinity;
  for (const bar of bars) {
    if (!Array.isArray(bar) || bar.length < 5) continue;
    const time = Number(bar[0]);
    if (!Number.isFinite(time) || time < startTime || time > endTime) continue;
    const open = Number(bar[1]);
    const close = Number(bar[4]);
    if (!Number.isFinite(open) || !Number.isFinite(close)) continue;
    const bodyHigh = Math.max(open, close);
    const bodyLow = Math.min(open, close);
    if (bodyHigh > upper) upper = bodyHigh;
    if (bodyLow < lower) lower = bodyLow;
  }
  if (!Number.isFinite(upper) || !Number.isFinite(lower)) return null;
  return { upper, lower };
};

export const getBoxFill = () => "rgba(59, 130, 246, 0.12)";
export const getBoxStroke = () => "rgba(59, 130, 246, 0.5)";

export const normalizeBoxes = (boxes: Box[]) => boxes ?? [];
