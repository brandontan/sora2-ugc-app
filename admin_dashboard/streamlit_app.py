import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import altair as alt
import pandas as pd
import requests
import streamlit as st
from supabase import Client, create_client

st.set_page_config(
    page_title="Sora Jobs Admin Dashboard",
    layout="wide",
    initial_sidebar_state="expanded",
)


STATUS_CANONICAL_MAP = {
    "queued": "queued",
    "queueing": "queued",
    "processing": "processing",
    "pending": "processing",
    "submitted": "processing",
    "in_progress": "processing",
    "started": "processing",
    "completed": "completed",
    "failed": "failed",
    "cancelled": "cancelled",
    "cancelled_user": "user_cancelled",
    "policy_blocked": "failed",
}

STATUS_DISPLAY_LABELS = {
    "queued": "Queued",
    "processing": "Processing",
    "completed": "Completed",
    "failed": "Failed",
    "cancelled": "Cancelled",
    "user_cancelled": "User Cancelled",
    "other": "Other",
}


def canonicalize_status(value: Optional[str]) -> str:
    if not value:
        return "other"
    normalized = value.lower()
    return STATUS_CANONICAL_MAP.get(normalized, "other")


def sanitize_env(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed.strip('"')


@st.cache_resource
def get_supabase_client() -> Client:
    url = sanitize_env(
        os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    )
    service_key = sanitize_env(os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

    if not url or not service_key:
        st.error(
            "Supabase credentials missing. "
            "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running the dashboard."
        )
        st.stop()

    return create_client(url, service_key)


@st.cache_data(ttl=30)
def fetch_jobs(limit: int) -> pd.DataFrame:
    client = get_supabase_client()
    response = (
        client.table("jobs")
        .select("*")
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )

    if response.error:
        raise RuntimeError(response.error.message)

    data: List[Dict[str, Any]] = response.data or []
    if not data:
        return pd.DataFrame()

    frame = pd.DataFrame(data)
    for column in ["created_at", "updated_at", "provider_last_checked"]:
        if column in frame.columns:
            frame[column] = pd.to_datetime(
                frame[column], utc=True, errors="coerce"
            )
    if "status" in frame.columns:
        frame["canonical_status"] = frame["status"].apply(
            lambda value: canonicalize_status(value if isinstance(value, str) else str(value) if value is not None else None)
        )
    else:
        frame["canonical_status"] = "other"
    frame["status_display"] = frame["canonical_status"].map(
        lambda value: STATUS_DISPLAY_LABELS.get(value, "Other")
    )
    return frame


def trigger_poller(limit: int) -> Dict[str, Any]:
    base_url = sanitize_env(
        os.getenv("SORA_POLLER_BASE_URL") or os.getenv("NEXT_PUBLIC_APP_URL")
    )
    admin_token = sanitize_env(os.getenv("ADMIN_DASHBOARD_TOKEN"))

    if not base_url or not admin_token:
        return {
            "ok": False,
            "message": "Set SORA_POLLER_BASE_URL and ADMIN_DASHBOARD_TOKEN to trigger the poller.",
        }

    url = f"{base_url.rstrip('/')}/api/sora/poller?limit={limit}"
    try:
        response = requests.get(
            url,
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=30,
        )
        payload = response.json() if response.headers.get("content-type", "").startswith("application/json") else {}
        if not response.ok:
            return {
                "ok": False,
                "message": f"Poller failed ({response.status_code}): {payload or response.text}",
            }
        return {"ok": True, "message": "Poller ran successfully.", "payload": payload}
    except requests.RequestException as error:
        return {"ok": False, "message": f"Poller request failed: {error}"}


st.title("Sora Jobs Admin Dashboard")
st.caption("Monitor job health across providers, trigger server poller, and inspect queue telemetry.")


with st.sidebar:
    st.header("Controls")
    poller_limit = st.slider("Poller batch size", min_value=1, max_value=25, value=5, step=1)

    if st.button("Run /api/sora/poller now"):
        result = trigger_poller(poller_limit)
        if result["ok"]:
            payload = result.get("payload") or {}
            processed = payload.get("processed")
            updated = payload.get("updated")
            st.success(
                f"Poller processed {processed} jobs and updated {updated}.", icon="✅"
            )
            fetch_jobs.clear()
        else:
            st.error(result["message"], icon="⚠️")

    if st.button("Refresh data"):
        fetch_jobs.clear()
        st.experimental_rerun()

    default_statuses = ["queued", "processing", "completed", "failed"]

jobs_limit = st.selectbox(
    "History window",
    options=[50, 100, 200, 500],
    index=1,
    help="Maximum number of recent jobs to load from Supabase.",
)

try:
    jobs_df = fetch_jobs(jobs_limit)
except RuntimeError as error:
    st.error(f"Failed to load jobs: {error}")
    st.stop()

if jobs_df.empty:
    st.info("No jobs found in Supabase. Launch a generation to populate data.")
    st.stop()

jobs_df["provider"] = jobs_df.get("provider", "fal").fillna("fal")

now_utc = datetime.now(timezone.utc)
jobs_df["last_touched_at"] = jobs_df["updated_at"].fillna(jobs_df["created_at"])
jobs_df["minutes_since_update"] = (
    (now_utc - jobs_df["last_touched_at"]).dt.total_seconds() / 60.0
)

active_mask = jobs_df["canonical_status"].isin(["queued", "processing"])
stuck_mask = active_mask & (jobs_df["minutes_since_update"] >= 10)
jobs_df["is_stuck"] = stuck_mask

providers = sorted(jobs_df["provider"].dropna().unique().tolist())
statuses = sorted(jobs_df["canonical_status"].dropna().unique().tolist())

selected_providers = st.multiselect(
    "Filter providers",
    options=providers,
    default=providers,
)
selected_statuses = st.multiselect(
    "Filter statuses",
    options=statuses,
    default=[status for status in statuses if status in default_statuses] or statuses,
    format_func=lambda value: STATUS_DISPLAY_LABELS.get(value, value.title()),
)

filtered_df = jobs_df[
    jobs_df["provider"].isin(selected_providers)
    & jobs_df["canonical_status"].isin(selected_statuses)
].copy()

summary_cols = st.columns(5)
summary_cols[0].metric("Total jobs", len(filtered_df))
summary_cols[1].metric(
    "Queued",
    int((filtered_df["canonical_status"] == "queued").sum()),
)
summary_cols[2].metric(
    "Processing",
    int((filtered_df["canonical_status"] == "processing").sum()),
)
summary_cols[3].metric(
    "Completed",
    int((filtered_df["canonical_status"] == "completed").sum()),
)
summary_cols[4].metric(
    "Flagged as stuck",
    int(filtered_df["is_stuck"].sum()),
)

chart_container = st.container()

with chart_container:
    left, right = st.columns([2, 3])

    status_counts = (
        filtered_df.groupby(["provider", "canonical_status"])
        .size()
        .reset_index(name="count")
    )
    status_counts["status_display"] = status_counts["canonical_status"].map(
        lambda value: STATUS_DISPLAY_LABELS.get(value, value.title())
    )
    status_chart = (
        alt.Chart(status_counts)
        .mark_bar()
        .encode(
            x=alt.X("status_display:N", title="Status"),
            y=alt.Y("count:Q", title="Jobs"),
            color=alt.Color("provider:N", title="Provider"),
            column=alt.Column("provider:N", title="Provider"),
        )
        .resolve_scale(y="independent")
    )
    left.subheader("Status mix per provider")
    left.altair_chart(status_chart, use_container_width=True)

    timeline_df = filtered_df.copy()
    timeline_df["timeline_bucket"] = (
        timeline_df["last_touched_at"]
        .dt.floor("15min")
        .dt.tz_convert(None)
    )
    timeline_counts = (
        timeline_df.groupby(["timeline_bucket", "provider"])
        .size()
        .reset_index(name="active_jobs")
    )
    timeline_chart = (
        alt.Chart(timeline_counts)
        .mark_line(point=True)
        .encode(
            x=alt.X("timeline_bucket:T", title="Time (15 min buckets)"),
            y=alt.Y("active_jobs:Q", title="Jobs in flight"),
            color=alt.Color("provider:N", title="Provider"),
        )
    )
    right.subheader("Queue activity (15 min buckets)")
    right.altair_chart(timeline_chart, use_container_width=True)

st.subheader("Job details")
display_columns = [
    "id",
    "user_id",
    "status_display",
    "provider",
    "provider_status",
    "queue_position",
    "minutes_since_update",
    "provider_error",
    "video_url",
    "created_at",
    "updated_at",
]

present_columns = [column for column in display_columns if column in filtered_df.columns]
table_df = filtered_df[present_columns].copy()
table_df["minutes_since_update"] = table_df["minutes_since_update"].round(1)
if "status_display" in table_df.columns:
    table_df = table_df.rename(columns={"status_display": "Status"})

styled_df = table_df.style.apply(
    lambda row: [
        "background-color: #ffe4e6" if stuck else ""
        for stuck in [filtered_df.loc[row.name, "is_stuck"]]
    ],
    axis=1,
)

st.dataframe(
    styled_df,
    use_container_width=True,
    height=480,
)

st.markdown("---")
st.subheader("Stuck jobs (>10 minutes without update)")

stuck_jobs = filtered_df[filtered_df["is_stuck"]]
if stuck_jobs.empty:
    st.success("No stalled jobs detected in the last batch.")
else:
    for _, row in stuck_jobs.iterrows():
        st.warning(
            f"Job {row['id']} ({row['provider']}) stuck at status {row.get('status_display') or row.get('status')} "
            f"for {row['minutes_since_update']:.1f} minutes. Provider status: "
            f"{row.get('provider_status') or 'n/a'}",
            icon="🛑",
        )
