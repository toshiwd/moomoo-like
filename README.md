# Mee Mee

Mee Mee (official name: MeeMee Screener) is a high-performance stock screener prototype inspired by MOOMOO Desktop.

## Windows PowerShell quick start

### Backend

```powershell
cd C:\work\meemee-screener\app\backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python ingest_txt.py
uvicorn main:app --reload --port 8000
```

### Frontend

```powershell
cd C:\work\meemee-screener\app\frontend
npm install
npm run dev
```

### Health check

```powershell
curl http://localhost:8000/api/health
curl http://localhost:8000/api/list
```

Open `http://localhost:5173` in a browser. If no TXT data is found, the UI will prompt you to place files under `data/txt`.