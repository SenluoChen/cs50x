# Popcorn — Natural Language Movie Recommender

Popcorn is a full-stack web application that allows users to search for movies using natural language queries (e.g. “crazy funny”, “90s romantic comedies”). 
Instead of traditional keyword search, it uses semantic embeddings to understand the meaning of the query and return relevant movie recommendations.

## 🎬 Demo Video

You can watch the demo video here: 🔗 https://www.youtube.com/watch?v=YOUR_VIDEO_LINK

---

This repo contains:
- A **React + TypeScript** frontend
- A **backend on AWS (CDK)** with:
  - Auth API (`/auth/*`, `/favorites/*`)
  - Semantic search API (`/search*`)
- Local tooling + datasets for building/searching a movie corpus

## Live site

The deployed frontend is served via CloudFront:
- `https://d3270r12pqj8e2.cloudfront.net`

## Architecture (AWS)

Deployed via the CDK app in `cdk/`:
- **Frontend**: S3 (static hosting) + CloudFront (SPA)
- **Backend**: ECS Fargate + ALB
  - Auth service handles `/auth/*` and `/favorites/*`
  - Search service handles `/search*`
- **Routing**: CloudFront forwards `/auth/*`, `/favorites/*`, and `/search*` to the ALB
- **Secrets**: OpenAI key is read from AWS Secrets Manager (see Deployment section)

See:
- `cdk/README.md`
- `cdk/README_DEPLOY.md`

## Repo layout

High-level folders:
- `frontend/popcorn-frontend/` — React UI (CRA)
- `cdk/` — AWS CDK v2 app (TypeScript) for frontend + backend
- `backend/cognito-auth-api/` — minimal auth backend (Express)
- `backend/vector-service/` — FAISS vector service (Python)
- `tools/` — local semantic search server + utilities
- `Movie-data/` — local dataset + FAISS index files
- `scripts/` — helper PowerShell scripts to run local services

## Prerequisites

Local dev:
- Node.js 18+ (repo uses Node 20 images in Docker builds; local 18+ is fine)
- npm

For AWS deploy:
- AWS CLI configured (`aws configure` or SSO)
- CDK bootstrapped in your account/region (`npx cdk bootstrap`)
- Docker Desktop running (CDK builds/pushes container assets)

## Quick start (frontend only)

From repo root:

```bash
cd frontend/popcorn-frontend
npm install
npm start
```

Environment variables (frontend):
- `REACT_APP_TMDB_API_KEY` — TMDb v3 API key (required for detail enrichment)
- `REACT_APP_AUTH_API_BASE` — Auth API base URL (e.g. `http://localhost:3001`)
- `REACT_APP_RELIVRE_API_URL` — Semantic search API base URL (e.g. `http://localhost:3002/`)
- `PORT` — dev server port (default `3000`)

## Local full stack (Windows/PowerShell)

Typical local ports:
- Frontend: `http://localhost:3000`
- Auth mock API: `http://localhost:3001`
- Semantic search API: `http://localhost:3002`
- FAISS vector service: `http://localhost:8008`

### 1) Start FAISS vector service (8008)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run_vector_service_8008.ps1
```

### 2) Start semantic search API (3002)

This runs the local Node server in `tools/local_search_api_server.js`.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run_semantic_search_api_3002.ps1
```

Notes:
- Reads `OPENAI_API_KEY` from your environment or from `backend/movie-api-test/.env`.
- Uses `LOCAL_DATA_PATH` if set; otherwise defaults to `Movie-data/` when present.

### 3) Start auth backend (mock) (3001)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\backend\cognito-auth-api\scripts\run_mock_server.ps1
```

### 4) Start frontend (3000)

```powershell
$env:REACT_APP_AUTH_API_BASE = "http://localhost:3001"
$env:REACT_APP_RELIVRE_API_URL = "http://localhost:3002/"
$env:PORT = "3000"
Set-Location .\frontend\popcorn-frontend
npm start
```

## Dataset & indexing

Local data is stored under `Movie-data/` by default:
- `Movie-data/movies/movies.ndjson` — movie metadata (NDJSON)
- `Movie-data/vectors/` — embeddings
- `Movie-data/index/` — FAISS index files

There are additional tools under `backend/movie-api-test/` and `tools/` for building a local corpus, enriching metadata, and benchmarking.

## Build

Frontend production build:

```bash
cd frontend/popcorn-frontend
npm run build
```

## Deployment (AWS)

Deployment is done via the CDK app in `cdk/`.

### 0) Create OpenAI secret (one-time)

Create an AWS Secrets Manager secret matching `secretNameOpenAi` in `cdk/cdk.json`.
Default name:
- `popcorn/openaiApiKey`

Value:
- raw OpenAI API key string

### 1) Bootstrap CDK (one-time per account/region)

```bash
cd cdk
npm install
npx cdk bootstrap
```

### 2) Build frontend

```bash
cd frontend/popcorn-frontend
npm install
npm run build
```

### 3) Deploy

```bash
cd cdk
npm run build
npm run deploy
```

After deploy, CloudFormation outputs include:
- `SiteUrl` (CloudFront URL)
- `AlbDnsName` (ALB DNS for backend)

For full details, see `cdk/README_DEPLOY.md`.

## Troubleshooting

### “Search results show N movies but no cards”

This can happen when the UI filters out items missing trailer or plot.
The search page shows a notice and offers a “Show all results” button when everything is filtered.

### CloudFront serving old assets

Try a hard refresh:
- Chrome/Edge: `Ctrl+F5`

### Missing `OPENAI_API_KEY`

Local semantic search requires `OPENAI_API_KEY`.
Set it in your environment or in `backend/movie-api-test/.env`.

### Docker build required for CDK deploy

The backend stacks build/push Docker images as CDK assets. Ensure Docker Desktop is running.

## License

Internal project — add license terms if/when you plan to open-source.

