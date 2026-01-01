from datetime import datetime
import os

from fastapi import Body, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from db import get_conn, init_schema

DATA_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "data", "txt"))
USE_CODE_TXT = os.getenv("USE_CODE_TXT", "0") == "1"


def find_code_txt_path(data_dir: str) -> str | None:
    direct = os.path.join(data_dir, "code.txt")
    if os.path.exists(direct):
        return direct
    parent = os.path.join(os.path.dirname(data_dir), "code.txt")
    if os.path.exists(parent):
        return parent
    return None

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)


@app.on_event("startup")
def on_startup():
    init_schema()


def get_txt_status() -> dict:
    if not os.path.isdir(DATA_DIR):
        return {
            "txt_count": 0,
            "code_txt_missing": False,
            "last_updated": None
        }

    txt_files = [
        os.path.join(DATA_DIR, name)
        for name in os.listdir(DATA_DIR)
        if name.endswith(".txt") and name.lower() != "code.txt"
    ]
    code_txt_missing = False
    if USE_CODE_TXT:
        code_txt_missing = find_code_txt_path(DATA_DIR) is None
    last_updated = None
    if txt_files:
        last_updated = max(os.path.getmtime(path) for path in txt_files)
        last_updated = datetime.utcfromtimestamp(last_updated).isoformat() + "Z"

    return {
        "txt_count": len(txt_files),
        "code_txt_missing": code_txt_missing,
        "last_updated": last_updated
    }


@app.get("/api/health")
def health():
    status = get_txt_status()
    with get_conn() as conn:
        code_count = conn.execute("SELECT COUNT(DISTINCT code) FROM daily_bars").fetchone()[0]
    return {
        "ok": True,
        "txt_count": status["txt_count"],
        "code_count": code_count,
        "last_updated": status["last_updated"],
        "code_txt_missing": status["code_txt_missing"],
        "errors": []
    }


@app.get("/api/list")
def list_tickers():
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT d.code,
                   COALESCE(m.name, d.code) AS name,
                   COALESCE(m.stage, 'UNKNOWN') AS stage,
                   COALESCE(m.score, 0) AS score,
                   COALESCE(m.reason, 'TXT_ONLY') AS reason
            FROM (SELECT DISTINCT code FROM daily_bars) d
            LEFT JOIN stock_meta m ON d.code = m.code
            ORDER BY d.code
            """
        ).fetchall()
    return JSONResponse(content=rows)


@app.post("/api/batch_bars")
def batch_bars(payload: dict = Body(default={})):  # { timeframe, codes, limit }
    timeframe = payload.get("timeframe", "monthly")
    codes = payload.get("codes", [])
    limit = min(int(payload.get("limit", 60)), 60)

    if not codes:
        return JSONResponse(content={"timeframe": timeframe, "limit": limit, "items": {}})

    if timeframe == "daily":
        bars_table = "daily_bars"
        ma_table = "daily_ma"
        time_col = "date"
    else:
        bars_table = "monthly_bars"
        ma_table = "monthly_ma"
        time_col = "month"

    placeholders = ",".join(["?"] * len(codes))
    query = f"""
        WITH base AS (
            SELECT b.code,
                   b.{time_col} AS t,
                   b.o,
                   b.h,
                   b.l,
                   b.c,
                   m.ma7,
                   m.ma20,
                   m.ma60,
                   ROW_NUMBER() OVER (PARTITION BY b.code ORDER BY b.{time_col} DESC) AS rn
            FROM {bars_table} b
            LEFT JOIN {ma_table} m
              ON b.code = m.code AND b.{time_col} = m.{time_col}
            WHERE b.code IN ({placeholders})
        )
        SELECT code, t, o, h, l, c, ma7, ma20, ma60
        FROM base
        WHERE rn <= ?
        ORDER BY code, t
    """

    with get_conn() as conn:
        rows = conn.execute(query, codes + [limit]).fetchall()

    items: dict[str, dict[str, list]] = {}
    for code, t, o, h, l, c, ma7, ma20, ma60 in rows:
        payload = items.setdefault(code, {"bars": [], "ma": {"ma7": [], "ma20": [], "ma60": []}})
        payload["bars"].append([t, o, h, l, c])
        payload["ma"]["ma7"].append([t, ma7])
        payload["ma"]["ma20"].append([t, ma20])
        payload["ma"]["ma60"].append([t, ma60])

    return JSONResponse(content={"timeframe": timeframe, "limit": limit, "items": items})


@app.get("/api/ticker/daily")
def daily(code: str, limit: int = 400):
    with get_conn() as conn:
        rows = conn.execute(
            """
            WITH base AS (
                SELECT
                    b.date,
                    b.o,
                    b.h,
                    b.l,
                    b.c,
                    b.v,
                    m.ma7,
                    m.ma20,
                    m.ma60
                FROM daily_bars b
                LEFT JOIN daily_ma m
                  ON b.code = m.code AND b.date = m.date
                WHERE b.code = ?
                ORDER BY b.date
            ),
            tail AS (
                SELECT *
                FROM base
                ORDER BY date DESC
                LIMIT ?
            )
            SELECT date, o, h, l, c, v, ma7, ma20, ma60
            FROM tail
            ORDER BY date
            """,
            [code, limit]
        ).fetchall()

    return JSONResponse(content=rows)


@app.get("/api/ticker/monthly")
def monthly(code: str, limit: int = 240):
    with get_conn() as conn:
        rows = conn.execute(
            """
            WITH base AS (
                SELECT
                    month,
                    o,
                    h,
                    l,
                    c
                FROM monthly_bars
                WHERE code = ?
                ORDER BY month DESC
                LIMIT ?
            )
            SELECT month, o, h, l, c
            FROM base
            ORDER BY month
            """,
            [code, limit]
        ).fetchall()

    return JSONResponse(content=rows)
