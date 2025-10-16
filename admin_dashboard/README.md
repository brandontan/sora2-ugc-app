# Streamlit Admin Dashboard

This Streamlit app surfaces operational visibility for the Sora job queue. It connects directly to Supabase using the service role key, lets operators trigger the `/api/sora/poller` endpoint when webhooks misbehave, and highlights jobs that have been stuck in the queue for more than ten minutes.

## Setup

1. Create a virtual environment and install dependencies:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

2. Export the required environment variables:

```bash
export SUPABASE_URL=...
export SUPABASE_SERVICE_ROLE_KEY=...
export ADMIN_DASHBOARD_TOKEN=...
export SORA_POLLER_BASE_URL=https://<your-app>.vercel.app
# Optional: override if you need a different base URL for the Next.js poller
# export SORA_POLLER_BASE_URL=http://localhost:3000
```

3. Run Streamlit:

```bash
streamlit run streamlit_app.py
```

The dashboard loads the latest jobs, shows summary metrics per provider, and offers filters and charts to inspect queue health. Use the sidebar action to trigger the poller in production **only** when manual reconciliation is required; Fal webhooks now handle normal updates.

## Production poller fallback

The Next.js app exposes the poller endpoint for emergency use:

- `ADMIN_DASHBOARD_TOKEN` — used by operators and the Streamlit dashboard to trigger `/api/sora/poller` manually.
- `CRON_SECRET` — optional; provide only if you intend to wire a temporary cron job during incidents.

Fal webhooks (`/api/provider/fal/webhook`) handle routine status reconciliation. The cron schedule in `frontend/vercel.json` has been removed; if you re-enable it during an incident, ensure both secrets are configured in Vercel (`Production` env) and disable the schedule once the webhook backlog clears.
