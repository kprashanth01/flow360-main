# Flow360

Flow360 is an agentic next best action platform for B2B workforce and staffing operations. It turns customer interactions, CRM history, enterprise playbooks, candidate data, and persistent memory into ranked, explainable recommendations that a human can approve or reject.

The goal is not to build another chatbot or basic RAG demo. Flow360 is designed as reusable decision intelligence infrastructure with planner-led agents, enterprise retrieval, persistent memory, explainable recommendations, and human-in-the-loop review.

## Team Details

- Team/project name: Flow360
- Repository owner: kprashanth01
- Submission repository: https://github.com/kprashanth01/flow360-demo
- Demo domain: Healthcare staffing operations for Northstar Health Network

## Submission Deliverables

- `README.md`: project overview, setup instructions, repository link, and notes
- `Architecture.md`: high-level architecture and key design decisions

## What This Project Solves

Staffing and workforce teams make high-pressure decisions from scattered context:

- Meeting notes and client calls
- Email threads and CRM updates
- Candidate shortlists
- Credentialing rules
- Rate card policies
- Escalation playbooks
- Renewal and SLA history

Flow360 combines those signals and recommends what the account manager or recruiter should do next.

Example:

> Escalate Priya N.'s license verification because the start date is within 5 days, license verification is incomplete, and the account has prior SLA breach risk. Confidence: 89%. Evidence: meeting transcript, credentialing checklist, CRM account history.

## Core Features

- Premium SaaS landing page with a dark cinematic Flow360 hero
- Operator dashboard for account managers
- Planner-driven agent workflow using LangGraph
- Text and file ingestion for transcripts, CRM notes, emails, PDFs, and docs
- LlamaIndex-style chunking for retrieval-ready enterprise knowledge
- Supabase Postgres and pgvector memory store
- Ollama local embeddings using `nomic-embed-text:latest`
- Groq LLM routing with API key rotation
- Ranked next best action recommendations
- Evidence, confidence, rationale, owner, due date, and business metric per recommendation
- Human approval or rejection before recommendations are accepted
- Persistent memory updates from human review
- Memory graph UI
- Ask Memory assistant over persistent account memory
- Demo fallback mode if Supabase or Groq is not configured

The main feature breakdown is included below, with architecture details in [Architecture.md](Architecture.md).

## Architecture

```text
Customer interaction / upload
        |
        v
FastAPI ingestion endpoints
        |
        v
LangGraph Planner Agent
        |
        +--> Ingestion Agent
        +--> Retrieval Agent
        +--> Business Analyst Agent
        +--> Recommendation Agent
        +--> Memory Agent
        |
        v
Supabase Postgres + pgvector memory
        |
        v
Next.js operator dashboard
        |
        v
Human review and memory update
```

## Tech Stack

### Frontend

- Next.js App Router
- TypeScript
- Tailwind CSS
- lucide-react icons
- Recharts

### Backend

- FastAPI
- LangGraph
- LlamaIndex-related utilities
- Groq SDK
- Supabase Python client
- Pydantic

### Data And Memory

- Supabase Postgres
- Supabase pgvector
- Supabase Storage-ready configuration
- Ollama embeddings with `nomic-embed-text:latest`

### LLM

- Groq API
- Reasoning model: `llama-3.3-70b-versatile`
- Fast model: `llama-3.1-8b-instant`

Only the embedding model is local through Ollama. Groq and Supabase are cloud/API services.

## Folder Structure

```text
flow360/
  backend/
    app/
      agents/
        workflow.py
      services/
        embeddings.py
        groq_client.py
        llamaindex_adapter.py
        retrieval.py
        store.py
      main.py
      models.py
      config.py
    requirements.txt
    .env.example

  frontend/
    src/
      app/
        page.tsx
        app/page.tsx
        globals.css
      components/
        operator-dashboard.tsx
      lib/
        api.ts
        pending-source-samples.ts
        types.ts
    package.json
    .env.example

  supabase/
    sql/
      001_extensions.sql
      002_schema.sql
      003_vector_search.sql

  docs/
    setup.md
```

## Prerequisites

Install these before running the project:

- Python 3.11 or newer
- Node.js 20 or newer
- npm
- Ollama
- Supabase project
- Groq API key

For hackathon demo recording, Flow360 can also run with fallback behavior when Supabase, Groq, or Ollama are not configured. Live services enable the full production-style workflow.

## 1. Clone The Repository

```powershell
git clone https://github.com/kprashanth01/flow360-demo
cd flow360-demo
```

If you already have the local folder, continue from the project root.

## 2. Install Ollama Embedding Model

Flow360 uses Ollama only for embeddings. Install and start Ollama, then pull the embedding model:

```powershell
ollama pull nomic-embed-text:latest
ollama list
```

Verify that `nomic-embed-text:latest` appears in the list.

Ollama should be available at:

```text
http://localhost:11434
```

## 3. Configure Supabase

Create a Supabase project, open the SQL editor, and run these scripts in order:

```text
supabase/sql/001_extensions.sql
supabase/sql/002_schema.sql
supabase/sql/003_vector_search.sql
```

These scripts enable pgvector, create the platform tables, and add vector search RPCs.

## 4. Configure Backend Environment

Copy the backend env template:

```powershell
Copy-Item backend\.env.example backend\.env
```

Edit `backend\.env`:

```env
ENVIRONMENT=local
BACKEND_CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000

GROQ_API_KEYS=your_groq_key_1,your_groq_key_2
GROQ_REASONING_MODEL=llama-3.3-70b-versatile
GROQ_FAST_MODEL=llama-3.1-8b-instant

SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
SUPABASE_STORAGE_BUCKET=documents

OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_EMBED_MODEL=nomic-embed-text:latest
EMBEDDING_DIM=768
```

Important:

- Do not commit real `.env` files.
- Regenerate any API keys that were shared in chat or screenshots.
- The app can run in demo fallback mode, but Supabase and Groq enable the full live workflow.

## 5. Create Backend Virtual Environment

From the project root:

```powershell
py -m venv backend\.venv
backend\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
```

Start the FastAPI backend:

```powershell
uvicorn app.main:app --reload --app-dir backend --port 8000
```

Check the backend:

```powershell
Invoke-WebRequest http://127.0.0.1:8000/health -UseBasicParsing
```

You can also open Swagger:

```text
http://127.0.0.1:8000/docs
```

## 6. Configure Frontend Environment

In another terminal:

```powershell
Copy-Item frontend\.env.example frontend\.env.local
```

The default value should be:

```env
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
```

## 7. Install And Run Frontend

```powershell
cd frontend
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

## Backend Endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Backend, Groq, and Supabase status |
| `POST /ingest/text` | Ingest pasted text |
| `POST /ingest/upload` | Upload and index files |
| `POST /agent/run` | Run the planner-led workflow |
| `GET /agent/runs/{run_id}` | Fetch a saved agent run |
| `GET /recommendations` | List recommendations |
| `POST /recommendations/{id}/review` | Approve or reject a recommendation |
| `GET /memory/{entity_type}/{entity_id}` | Fetch memory cards |
| `POST /memory/query` | Ask questions over persistent memory |

## Verification Commands

Run frontend checks:

```powershell
cd frontend
npm run lint
npm run build
```

Check backend health:

```powershell
Invoke-WebRequest http://127.0.0.1:8000/health -UseBasicParsing
```

## Troubleshooting

### Ollama embedding errors

Make sure Ollama is running and the model is installed:

```powershell
ollama pull nomic-embed-text:latest
ollama list
```

### Supabase not connected

Check `backend\.env`:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Also confirm the SQL scripts were run in order.

### Groq not enabled

Check `backend\.env`:

```env
GROQ_API_KEYS=your_key_1,your_key_2
```

The backend accepts either comma-separated `GROQ_API_KEYS` or aliases such as `GROQ_API_KEY1`, `GROQ_API_KEY2`, and so on.

### Frontend cannot reach backend

Check `frontend\.env.local`:

```env
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
```

Then restart `npm run dev`.

## Documentation

- [Architecture](Architecture.md)
- [Setup guide](docs/setup.md)

## Security Notes

- Real API keys must stay in `.env` files only.
- `.env`, `.env.local`, and similar files are ignored by git.
- `.env.example` files are safe templates and are committed.
- Regenerate any keys that were exposed during development before submitting this repository.

## Additional Notes

- Dependency folders such as `node_modules/`, `.venv/`, `.next/`, caches, and build outputs are excluded through `.gitignore`.
- The app supports both live service mode and fallback demo behavior for reliable hackathon recording.
- Run the setup commands from a fresh clone before the final demo to verify the repository is self-contained.
