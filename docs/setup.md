# Flow360 Setup Guide

## 1. Backend

```powershell
Copy-Item backend\.env.example backend\.env
py -m venv backend\.venv
backend\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
uvicorn app.main:app --reload --app-dir backend --port 8000
```

Fill `backend\.env` with local values:

```env
GROQ_API_KEYS=key1,key2,key3
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_EMBED_MODEL=nomic-embed-text:latest
```

The app runs without these values using demo fallback mode.

## 2. Supabase

Open Supabase SQL editor and run:

1. `supabase/sql/001_extensions.sql`
2. `supabase/sql/002_schema.sql`
3. `supabase/sql/003_vector_search.sql`

## 3. Frontend

```powershell
Copy-Item frontend\.env.example frontend\.env.local
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`.

## 4. Landing Page Visuals

The landing page uses original CSS scene layers and a coded dashboard preview inspired by the provided premium AI SaaS reference. No reference screenshot is required at runtime.
