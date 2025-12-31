from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from db import get_conn, init_schema

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)


class CodesRequest(BaseModel):
    codes: list[str]


@app.on_event("startup")
def on_startup():
    init_schema()


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/list")
def list_tickers():
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT t.code, t.name, m.stage, m.score
            FROM tickers t
            LEFT JOIN ticker_meta m ON t.code = m.code
            ORDER BY t.code
            """
        ).fetchall()
    return {"items": rows}


@app.post("/api/batch_monthly")
def batch_monthly(req: CodesRequest):
    if not req.codes:
        return {}
    with get_conn() as conn:
        placeholders = ",".join(["?"] * len(req.codes))
        query = f"""
            SELECT code, t, o, h, l, c
            FROM monthly_bars
            WHERE code IN ({placeholders})
            ORDER BY code, t
        """
        rows = conn.execute(query, req.codes).fetchall()

    data = {}
    for code, t, o, h, l, c in rows:
        data.setdefault(code, []).append([t, o, h, l, c])
    return JSONResponse(content=data)


@app.get("/api/daily/{code}")
def daily(code: str):
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT t, o, h, l, c, v
            FROM daily_bars
            WHERE code = ?
            ORDER BY t
            """,
            [code]
        ).fetchall()
    return JSONResponse(content=rows)