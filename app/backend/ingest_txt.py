import os
import re
from datetime import datetime, timezone

import pandas as pd

from db import get_conn, init_schema

DATA_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "data", "txt"))


def compute_stage_score(monthly_df: pd.DataFrame) -> tuple[str, float, str]:
    # TODO: replace with Iizuka stage logic when available.
    return "UNKNOWN", 0.0, "TODO: Iizuka stage/score pipeline"


def infer_code_from_filename(path: str) -> str | None:
    base = os.path.splitext(os.path.basename(path))[0]
    match = re.match(r"\s*([0-9A-Za-z]+)", base)
    return match.group(1) if match else None


def load_watchlist(data_dir: str) -> set[str] | None:
    path = os.path.join(data_dir, "code.txt")
    if not os.path.exists(path):
        print("Warning: code.txt is missing. Falling back to TXT filenames.")
        return None
    with open(path, "r", encoding="utf-8") as f:
        codes = [line.strip() for line in f.readlines() if line.strip()]
    return set(codes) if codes else None


def select_txt_files(data_dir: str) -> list[str]:
    if not os.path.isdir(data_dir):
        return []
    candidates = [
        os.path.join(data_dir, name)
        for name in os.listdir(data_dir)
        if name.endswith(".txt") and name.lower() != "code.txt"
    ]

    latest_per_code: dict[str, tuple[str, float]] = {}
    passthrough: list[str] = []
    for path in candidates:
        inferred = infer_code_from_filename(path)
        mtime = os.path.getmtime(path)
        if inferred:
            current = latest_per_code.get(inferred)
            if current is None or mtime > current[1]:
                latest_per_code[inferred] = (path, mtime)
        else:
            passthrough.append(path)

    selected = [entry[0] for entry in latest_per_code.values()] + passthrough
    return selected


def read_csv_with_fallback(path: str) -> pd.DataFrame:
    encodings = ["utf-8", "shift_jis", "cp932"]
    last_err: Exception | None = None
    for encoding in encodings:
        try:
            return pd.read_csv(
                path,
                header=None,
                names=["code", "date", "o", "h", "l", "c", "v"],
                dtype="string",
                encoding=encoding
            )
        except Exception as exc:
            last_err = exc
    if last_err:
        raise last_err
    raise RuntimeError("Failed to read CSV")


def strip_header_row(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df
    first = df.iloc[0].astype(str).str.lower().tolist()
    if len(first) >= 6 and first[0] in {"code", "ticker"} and "date" in first[1]:
        return df.iloc[1:].reset_index(drop=True)
    return df


def read_daily_files(data_dir: str) -> pd.DataFrame:
    files = select_txt_files(data_dir)
    if not files:
        return pd.DataFrame(columns=["code", "date", "o", "h", "l", "c", "v"])

    watchlist = load_watchlist(data_dir)
    frames = []
    for path in files:
        df = read_csv_with_fallback(path)
        df = strip_header_row(df)

        inferred_code = infer_code_from_filename(path)
        if inferred_code:
            df["code"] = df["code"].fillna(inferred_code)
            df.loc[df["code"].str.len() == 0, "code"] = inferred_code

        df["date"] = pd.to_datetime(df["date"], errors="coerce")
        df = df.dropna(subset=["date"])
        if watchlist:
            df = df[df["code"].isin(watchlist)]
        if df.empty:
            continue

        for col in ["o", "h", "l", "c", "v"]:
            df[col] = pd.to_numeric(df[col], errors="coerce")
        df = df.dropna(subset=["o", "h", "l", "c", "v"])
        if df.empty:
            continue

        frames.append(df)

    if not frames:
        return pd.DataFrame(columns=["code", "date", "o", "h", "l", "c", "v"])

    daily = pd.concat(frames, ignore_index=True)
    daily["date"] = daily["date"].dt.tz_localize("UTC")
    daily["date"] = (daily["date"].astype("int64") // 1_000_000_000).astype("int64")
    return daily


def build_monthly(daily: pd.DataFrame) -> pd.DataFrame:
    daily_dt = pd.to_datetime(daily["date"], unit="s", utc=True)
    daily = daily.assign(dt=daily_dt)
    daily["month"] = daily["dt"].dt.to_period("M").dt.to_timestamp(tz="UTC")
    grouped = daily.sort_values("dt").groupby(["code", "month"], as_index=False)
    monthly = grouped.agg(
        o=("o", "first"),
        h=("h", "max"),
        l=("l", "min"),
        c=("c", "last")
    )
    monthly["month"] = (monthly["month"].astype("int64") // 1_000_000_000).astype("int64")
    return monthly


def build_monthly_ma(monthly: pd.DataFrame) -> pd.DataFrame:
    monthly = monthly.sort_values(["code", "month"]).copy()
    monthly["ma7"] = monthly.groupby("code")["c"].rolling(7).mean().reset_index(level=0, drop=True)
    monthly["ma20"] = monthly.groupby("code")["c"].rolling(20).mean().reset_index(level=0, drop=True)
    monthly["ma60"] = monthly.groupby("code")["c"].rolling(60).mean().reset_index(level=0, drop=True)
    return monthly[["code", "month", "ma7", "ma20", "ma60"]]


def build_daily_ma(daily: pd.DataFrame) -> pd.DataFrame:
    daily = daily.sort_values(["code", "date"]).copy()
    daily["ma7"] = daily.groupby("code")["c"].rolling(7).mean().reset_index(level=0, drop=True)
    daily["ma20"] = daily.groupby("code")["c"].rolling(20).mean().reset_index(level=0, drop=True)
    daily["ma60"] = daily.groupby("code")["c"].rolling(60).mean().reset_index(level=0, drop=True)
    return daily[["code", "date", "ma7", "ma20", "ma60"]]


def build_stock_meta(monthly: pd.DataFrame) -> pd.DataFrame:
    now = datetime.now(tz=timezone.utc)
    records = []
    for code, group in monthly.groupby("code"):
        stage, score, reason = compute_stage_score(group)
        records.append({
            "code": code,
            "name": code,
            "stage": stage,
            "score": score,
            "reason": reason,
            "updated_at": now
        })
    return pd.DataFrame(records)


def ingest() -> None:
    init_schema()
    daily = read_daily_files(DATA_DIR)
    if daily.empty:
        print("No TXT data found. Nothing to ingest.")
        return

    monthly = build_monthly(daily)
    monthly_ma = build_monthly_ma(monthly)
    daily_ma = build_daily_ma(daily)
    meta = build_stock_meta(monthly)

    with get_conn() as conn:
        conn.execute("DELETE FROM daily_bars")
        conn.execute("DELETE FROM daily_ma")
        conn.execute("DELETE FROM monthly_bars")
        conn.execute("DELETE FROM monthly_ma")
        conn.execute("DELETE FROM stock_meta")
        conn.execute("DELETE FROM tickers")

        conn.register("daily_df", daily)
        conn.execute("INSERT INTO daily_bars SELECT code, date, o, h, l, c, v FROM daily_df")

        conn.register("daily_ma_df", daily_ma)
        conn.execute("INSERT INTO daily_ma SELECT code, date, ma7, ma20, ma60 FROM daily_ma_df")

        conn.register("monthly_df", monthly)
        conn.execute("INSERT INTO monthly_bars SELECT code, month, o, h, l, c FROM monthly_df")

        conn.register("monthly_ma_df", monthly_ma)
        conn.execute("INSERT INTO monthly_ma SELECT code, month, ma7, ma20, ma60 FROM monthly_ma_df")

        conn.register("meta_df", meta)
        conn.execute(
            "INSERT INTO stock_meta SELECT code, name, stage, score, reason, updated_at FROM meta_df"
        )

        conn.execute("INSERT INTO tickers SELECT code, name FROM meta_df")

    print(f"Inserted {len(meta)} tickers")
    print(f"Inserted {len(monthly)} monthly rows")
    print(f"Inserted {len(daily)} daily rows")


def main() -> None:
    ingest()


if __name__ == "__main__":
    main()