import type { MaSetting } from "../store";

const cache = new Map<string, string>();

const buildSettingsKey = (settings: MaSetting[]) =>
  settings
    .map((setting) => `${setting.period}-${setting.visible}-${setting.color}-${setting.lineWidth}`)
    .join("|");

export const buildThumbnailCacheKey = (
  code: string,
  timeframe: "monthly" | "weekly" | "daily",
  showBoxes: boolean,
  maSettings: MaSetting[]
) => {
  const settingsKey = buildSettingsKey(maSettings);
  return `${code}:${timeframe}:${showBoxes}:${settingsKey}`;
};

export const getThumbnailCache = (key: string) => cache.get(key);

export const setThumbnailCache = (key: string, dataUrl: string) => {
  cache.set(key, dataUrl);
};
