# Streamlit Admin Dashboard

This Streamlit app surfaces operational visibility for the Sora job queue. It connects directly to Supabase using the service role key, lets operators trigger the `/api/sora/poller` endpoint, and highlights jobs that have been stuck in the queue for more than ten minutes.

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
```

3. Run Streamlit:

```bash
streamlit run streamlit_app.py
```

The dashboard loads the latest jobs, shows summary metrics per provider, and offers filters and charts to inspect queue health. Use the sidebar action to trigger the poller in production when manual reconciliation is required.
