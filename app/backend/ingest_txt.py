import os
import re
from datetime import datetime, timezone

import pandas as pd

from db import get_conn, init_schema

DATA_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "data", "txt"))
CODE_PATTERN_DEFAULT = r"^[0-9A-Za-z]{4,16}$"
CODE_PATTERN = re.compile(os.getenv("CODE_PATTERN", CODE_PATTERN_DEFAULT))
STRICT_CODE_VALIDATION = os.getenv("CODE_STRICT", "0") == "1"
USE_CODE_TXT = os.getenv("USE_CODE_TXT", "0") == "1"


def find_code_txt_path(data_dir: str) -> str | None:
    direct = os.path.join(data_dir, "code.txt")
    if os.path.exists(direct):
        return direct
    parent = os.path.join(os.path.dirname(data_dir), "code.txt")
    if os.path.exists(parent):
        return parent
    return None


def name_from_filename(path: str, code: str) -> str | None:
    base = os.path.splitext(os.path.basename(path))[0]
    if "_" not in base:
        return None
    code_part, name_part = base.split("_", 1)
    if code_part != code:
        return None
    name = name_part.strip()
    return name if name else None


def compute_stage_score(monthly_df: pd.DataFrame) -> tuple[str, float, str]:
    # TODO: replace with Iizuka stage logic when available.
    return "UNKNOWN", 0.0, "TODO: Iizuka stage/score pipeline"


def load_watchlist(data_dir: str) -> set[str] | None:
    if not USE_CODE_TXT:
        return None
    path = find_code_txt_path(data_dir)
    if not path:
        print("Warning: code.txt is missing. Falling back to TXT contents.")
        return None
    with open(path, "r", encoding="utf-8") as f:
        codes = [line.strip() for line in f.readlines() if line.strip()]
    return set(codes) if codes else None


def list_txt_files(data_dir: str) -> list[str]:
    if not os.path.isdir(data_dir):
        return []
    return [
        os.path.join(data_dir, name)
        for name in os.listdir(data_dir)
        if name.endswith(".txt") and name.lower() != "code.txt"
    ]


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
                encoding=encoding,
                usecols=[0, 1, 2, 3, 4, 5, 6]
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


def normalize_code(df: pd.DataFrame) -> tuple[pd.DataFrame, int, int, int]:
    df["code"] = df["code"].where(df["code"].notna(), "")
    df["code"] = df["code"].astype(str).str.strip()
    missing_mask = (df["code"] == "") | (df["code"].str.lower() == "nan")
    missing_count = int(missing_mask.sum())
    df = df[~missing_mask]

    nonstandard_mask = ~df["code"].str.match(CODE_PATTERN, na=False)
    nonstandard_count = int(nonstandard_mask.sum())
    invalid_count = 0
    if STRICT_CODE_VALIDATION and nonstandard_count:
        invalid_count = nonstandard_count
        df = df[~nonstandard_mask]

    return df, missing_count, nonstandard_count, invalid_count


def parse_file(path: str, watchlist: set[str] | None, counts: dict) -> pd.DataFrame:
    try:
        df = read_csv_with_fallback(path)
    except Exception as exc:
        counts["file_error"] += 1
        print(f"Warning: failed to read {path}: {exc}")
        return pd.DataFrame(columns=["code", "date", "o", "h", "l", "c", "v"])

    df = strip_header_row(df)
    if df.empty:
        return df

    df, missing_code, nonstandard_code, invalid_code = normalize_code(df)
    counts["missing_code"] += missing_code
    counts["nonstandard_code"] += nonstandard_code
    counts["invalid_code"] += invalid_code

    if df.empty:
        return df

    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    invalid_date = int(df["date"].isna().sum())
    counts["invalid_date"] += invalid_date
    df = df[df["date"].notna()]
    if df.empty:
        return df

    if watchlist:
        before = len(df)
        df = df[df["code"].isin(watchlist)]
        counts["filtered_watchlist"] += int(before - len(df))

    if df.empty:
        return df

    for col in ["o", "h", "l", "c", "v"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    non_numeric_mask = df[["o", "h", "l", "c", "v"]].isna().any(axis=1)
    counts["non_numeric"] += int(non_numeric_mask.sum())
    df = df[~non_numeric_mask]
    if df.empty:
        return df

    df["v"] = df["v"].round().astype("int64")
    return df


def read_daily_files(
    files: list[str], watchlist: set[str] | None, counts: dict
) -> tuple[pd.DataFrame, dict[str, str]]:
    latest_by_code: dict[str, tuple[float, pd.DataFrame]] = {}
    name_map: dict[str, str] = {}
    for path in files:
        df = parse_file(path, watchlist, counts)
        if df.empty:
            continue

        mtime = os.path.getmtime(path)
        for code, group in df.groupby("code"):
            existing = latest_by_code.get(code)
            if existing is None:
                latest_by_code[code] = (mtime, group)
                display_name = name_from_filename(path, code)
                if display_name:
                    name_map[code] = display_name
                continue
            if existing[0] >= mtime:
                counts["older_file"] += len(group)
                continue
            counts["older_file"] += len(existing[1])
            latest_by_code[code] = (mtime, group)
            display_name = name_from_filename(path, code)
            if display_name:
                name_map[code] = display_name

    frames = [entry[1] for entry in latest_by_code.values()]
    if not frames:
        return pd.DataFrame(columns=["code", "date", "o", "h", "l", "c", "v"]), name_map

    daily = pd.concat(frames, ignore_index=True)
    daily["date"] = daily["date"].dt.tz_localize("UTC")
    daily["date"] = (daily["date"].astype("int64") // 1_000_000_000).astype("int64")
    return daily, name_map


def build_monthly(daily: pd.DataFrame) -> pd.DataFrame:
    daily_dt = pd.to_datetime(daily["date"], unit="s", utc=True)
    daily = daily.assign(dt=daily_dt)
    daily["month"] = daily["dt"].dt.to_period("M").dt.to_timestamp()
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


def build_stock_meta(monthly: pd.DataFrame, name_map: dict[str, str]) -> pd.DataFrame:
    now = datetime.now(tz=timezone.utc)
    records = []
    for code, group in monthly.groupby("code"):
        stage, score, reason = compute_stage_score(group)
        records.append({
            "code": code,
            "name": name_map.get(code, code),
            "stage": stage,
            "score": score,
            "reason": reason,
            "updated_at": now
        })
    return pd.DataFrame(records)


def clear_tables() -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM daily_bars")
        conn.execute("DELETE FROM daily_ma")
        conn.execute("DELETE FROM monthly_bars")
        conn.execute("DELETE FROM monthly_ma")
        conn.execute("DELETE FROM stock_meta")
        conn.execute("DELETE FROM tickers")


def log_counts(counts: dict, parsed_rows: int) -> None:
    skipped_total = sum(
        counts[key]
        for key in [
            "missing_code",
            "invalid_date",
            "non_numeric",
            "invalid_code",
            "older_file",
            "filtered_watchlist"
        ]
    )
    reason_text = (
        f"missing_code={counts['missing_code']}, "
        f"invalid_date={counts['invalid_date']}, "
        f"non_numeric={counts['non_numeric']}, "
        f"invalid_code={counts['invalid_code']}, "
        f"older_file={counts['older_file']}, "
        f"filtered_watchlist={counts['filtered_watchlist']}"
    )
    print(f"PARSED_ROWS={parsed_rows}")
    print(f"SKIPPED_ROWS={skipped_total} ({reason_text})")
    print(f"NONSTANDARD_CODE_ROWS={counts['nonstandard_code']}")
    print(f"FILE_ERRORS={counts['file_error']}")


def ingest() -> None:
    init_schema()

    print(f"TXT_DIR={DATA_DIR}")
    files = list_txt_files(DATA_DIR)
    print(f"FOUND_FILES={len(files)}")

    counts = {
        "missing_code": 0,
        "invalid_date": 0,
        "non_numeric": 0,
        "invalid_code": 0,
        "older_file": 0,
        "filtered_watchlist": 0,
        "nonstandard_code": 0,
        "file_error": 0
    }

    if not files:
        clear_tables()
        log_counts(counts, 0)
        print("No TXT data found. Tables cleared.")
        return

    watchlist = load_watchlist(DATA_DIR)
    daily, name_map = read_daily_files(files, watchlist, counts)

    if daily.empty:
        clear_tables()
        log_counts(counts, 0)
        print("No valid TXT rows found. Tables cleared.")
        return

    monthly = build_monthly(daily)
    monthly_ma = build_monthly_ma(monthly)
    daily_ma = build_daily_ma(daily)
    meta = build_stock_meta(monthly, name_map)

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

    log_counts(counts, len(daily))
    print(f"Inserted {len(meta)} tickers")
    print(f"Inserted {len(monthly)} monthly rows")
    print(f"Inserted {len(daily)} daily rows")


def main() -> None:
    ingest()


if __name__ == "__main__":
    main()
