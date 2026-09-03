# AI-Powered Logistics Analytics Dashboard

An analytics dashboard over a logistics order dataset, with a natural-language
interface and demand forecasting.

The organising idea is that **the AI never produces a number**. It reads a
question, picks one of two tools, and fills in that tool's parameters. Those
parameters are validated against a fixed vocabulary of metrics and dimensions
and then executed by an ordinary SQL query builder. If the model asks for
something the vocabulary does not contain, the request is rejected rather than
answered. Every answer ships with the plan that produced it.

- **Frontend** — React + TypeScript + Vite + Recharts, deployed on Vercel
- **Backend** — FastAPI + SQLAlchemy Core + PostgreSQL, Docker on a VPS
- **AI** — Anthropic `claude-opus-5`, tool use only

---

## Contents

- [Running it locally](#running-it-locally)
- [Environment variables](#environment-variables)
- [System overview](#system-overview)
- [How a question becomes an answer](#how-a-question-becomes-an-answer)
- [Metric definitions](#metric-definitions)
- [Forecasting](#forecasting)
- [Deployment](#deployment)
- [Tests](#tests)
- [Assumptions and simplifications](#assumptions-and-simplifications)
- [Limitations and unsupported queries](#limitations-and-unsupported-queries)
- [Future improvements](#future-improvements)
- [AI usage disclosure](#ai-usage-disclosure)

---

## Running it locally

**Requirements:** Python 3.12, Node 20+, Docker (for Postgres).

### Backend

```bash
cd backend

# 1. Postgres
docker compose up -d db

# 2. Dependencies
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt

# 3. Configure
cp .env.example .env        # then edit; see the table below

# 4. Load the CSV and create the read-only role
.venv/bin/python -m app.seed
# -> Seeded 400 orders spanning 2025-01-01 .. 2025-12-30

# 5. Run
.venv/bin/uvicorn app.main:app --reload --port 8000
```

The API is then on `http://localhost:8000`, with interactive docs at
`http://localhost:8000/docs`.

### Frontend

```bash
cd frontend
npm install
cp .env.example .env        # VITE_API_BASE_URL=http://localhost:8000
npm run dev                 # http://localhost:5173
```

The dashboard works without an Anthropic API key. Only the **Ask a question**
tab needs one; without it that tab shows a notice and the endpoint returns
`503`.

## Environment variables

### `backend/.env`

| Variable | Purpose |
|---|---|
| `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` | Owner credentials. Used by the seed script only. |
| `POSTGRES_HOST` / `POSTGRES_PORT` | `localhost` / `5432` locally, `db` / `5432` in Docker. |
| `READONLY_USER` / `READONLY_PASSWORD` | The role the API logs in as. Created by the seed script with `SELECT` and nothing else. |
| `ANTHROPIC_API_KEY` | Required for `/api/ask`. Everything else works without it. |
| `ANTHROPIC_MODEL` | Defaults to `claude-opus-5`. |
| `CORS_ORIGINS` | Comma-separated allowed origins. In production this is the exact Vercel URL, never `*`. |
| `POSTGRES_PUBLISH_PORT` | Host port for Postgres, bound to `127.0.0.1` only. Defaults to `5432`. |

### `frontend/.env`

| Variable | Purpose |
|---|---|
| `VITE_API_BASE_URL` | Base URL of the backend, no trailing slash. |

No secrets are committed. `.env` is gitignored in both projects; `.env.example`
documents the shape.

---

## System overview

```
                    ┌──────────────────────────────────────────┐
  question ────────▶│ 1. ROUTE      Claude picks one tool and   │
                    │               fills in its parameters     │
                    └────────────────────┬─────────────────────┘
                                         │  {metrics, group_by, filters, …}
                    ┌────────────────────▼─────────────────────┐
                    │ 2. VALIDATE   Pydantic QuerySpec.         │
                    │               Anything outside the        │
                    │               registry is rejected here.  │
                    └────────────────────┬─────────────────────┘
                                         │
                    ┌────────────────────▼─────────────────────┐
                    │ 3. COMPUTE    SQLAlchemy builder →        │
                    │               parameterized SQL →         │
                    │               Postgres (read-only role)   │
                    └────────────────────┬─────────────────────┘
                                         │  rows + QueryPlan
                    ┌────────────────────▼─────────────────────┐
                    │ 4. NARRATE    Claude writes prose over    │
                    │               the computed rows.          │
                    │               tool_choice: none           │
                    └────────────────────┬─────────────────────┘
                                         │
  answer ◀───────── prose + chart + query plan + underlying rows
```

### Key design decisions

**A semantic layer, not text-to-SQL.** `app/semantic/schema.py` defines a
`QuerySpec`: a list of metrics, up to two dimensions to group by, filters over
categorical fields, and a time range. Every identifier is an enum. That one
object is simultaneously the tool schema the model fills in, the input to the
query builder, and the basis of the explanation shown to the user — so the
explanation cannot describe a different query from the one that ran.

**Metrics are defined exactly once.** `app/semantic/registry.py` maps each
metric to a SQL expression and to the English sentence that defines it. The
KPI cards, the preset charts and the natural-language answers all read from it,
so a card and a chat answer cannot disagree.

**The model has no database access.** It never sees SQL, never writes SQL, and
cannot name a column. Filter values travel as bound parameters. A hostile
filter value is data, not code — there is a test for exactly that.

**The database enforces read-only.** The seed script runs as the owner; the API
connects as a separate role holding `SELECT` on `orders` and nothing more.
`INSERT`, `UPDATE` and `DELETE` fail with `permission denied` even if the
application had a bug that tried one.

**Chart type is chosen by code, not by the model.** `app/analytics/charts.py`
picks from the shape of the result — a time bucket becomes a line, a
categorical breakdown becomes bars, long labels flip them horizontal, a count
split by status becomes a donut. It is free, it is stable across identical
questions, and the rule that fired is returned as `reason` and shown in the UI.

**Two calls, no agentic loop.** Between the two model calls everything is
deterministic code. A loop would let the model retry a rejected tool call with
a different guess, which costs more and makes the same question answerable two
different ways. A rejected call surfaces as a `422` explaining what is not
supported.

### Layout

```
backend/app/
  semantic/schema.py      the contract: QuerySpec, QueryPlan, the enums
  semantic/registry.py    every metric and dimension, defined once
  semantic/builder.py     QuerySpec -> parameterized SQL (the only SQL path)
  semantic/executor.py    execution + plan assembly
  analytics/registry-driven KPIs and preset charts, chart-type selection
  forecasting/grain.py    refuses SKU-level forecasts, substitutes the category
  forecasting/engine.py   moving average, linear regression, holdout scoring
  ai/tools.py             tool schemas, generated from the registry
  ai/prompts.py           system prompt, including the real column vocabulary
  ai/router.py            route -> validate -> compute -> narrate
  api/                    FastAPI routes
```

---

## How a question becomes an answer

**1. Routing.** One call to `claude-opus-5` with two tools:

- `query_analytics` — anything that already happened: counts, rates, averages,
  rankings, breakdowns, trends.
- `forecast_demand` — anything about the future.

The system prompt carries the **actual distinct values** of every
low-cardinality column, read from the database at first use. Without them the
model guesses filter strings — `Fedex`, `Europe`, `late` — that match nothing
and return zero rows: a wrong answer that looks like a real one.

Effort is set to `low` on both calls. Routing is a classification task and the
narration is three sentences; neither improves with more deliberation.

**2. Validation.** The tool arguments are parsed into a `QuerySpec`. An
invented metric, an unfilterable field, a contradictory time window or an extra
key all fail here, before any SQL exists.

**3. Computation.** The builder resolves the time range, applies filters as
bound parameters, groups, sorts and limits. Rate metrics automatically carry
their denominator as `sample_size`.

**4. Narration.** The computed rows go back to the model with
`tool_choice: {"type": "none"}` so it must answer in prose rather than compute
again. The system prompt forbids stating any figure not present in the tool
result.

**If the model declines to call a tool** — for a question about profit margin,
say — that is treated as a valid answer, not a failure. The response is marked
`unsupported` and the UI offers questions that can be answered.

### The tools are not declared `strict`

Strict tool use requires every property to appear in `required`, which forces
optional things (a time window, a sort) into sentinel encodings that are easy
to get subtly wrong. The Pydantic `QuerySpec` is the real enforcement boundary
and rejects anything the enums do not cover, so strict mode would add
brittleness without adding safety.

---

## Metric definitions

Two of these depend on a judgement call the data does not settle on its own.
Both are shown in the UI behind the `i` on each KPI card, and both are attached
to every query plan that uses them.

| Metric | Definition |
|---|---|
| `total_orders` | `COUNT(*)` — all statuses. **400** |
| `delivered_orders` | status = `delivered`. **304** |
| `delayed_orders` | status = `delayed`. **55** |
| `on_time_rate` | `delivered / (delivered + delayed + exception)`. **82.16%** over **370** |
| `delay_rate` | `delayed / (delivered + delayed + exception)` |
| `avg_delivery_days` | `AVG(delivery_date - order_date)` where `delivery_date IS NOT NULL`. **3.83** over **370** |
| `total_revenue` / `avg_order_value` | over `order_value_usd` |
| `total_quantity` | `SUM(quantity)` |

**Why on-time comes from `status`.** The dataset has **no promised or SLA
delivery date**, so "on time" cannot be computed from dates — there is nothing
to be on time relative to. It is taken from the `status` column instead. Lead
times support this reading: delivered averages 3.25 days, delayed 6.11,
exception 8.45. The status column is a coherent outcome label.

**Why 370 and not 400.** Exactly 30 orders have no `delivery_date`, and they
are precisely the 27 `in_transit` and 3 `canceled` ones. They have no delivery
outcome yet, so they are excluded from every rate denominator and from average
delivery time. Dividing by 400 understates delivery time by about 8% and
understates the on-time rate by the same kind of margin.

**Every rate carries its denominator.** Asked *"which carrier has the highest
delay rate?"*, the answer is GLS at 25.0% — over **8 orders**. USPS is next at
23.4% over **47**. A ranking led by a group of eight is not a finding, so
`sample_size` is returned on every rate row, rendered in the UI, and the model
is instructed to state it.

**Relative dates anchor to the data, not to today.** The dataset ends
2025-12-30. "Last month" resolves to 2025-12-01 → 2025-12-30, the most recent
month *in the dataset*. Anchoring to the real calendar would return zero rows
for every recency question. The anchor is shown in the query plan.

---

## Forecasting

Monthly aggregates, 12 points, noisy and declining (75 orders in January down
to 18 in September). That rules out anything seasonal or autoregressive — there
is not enough history to fit it, and a heavier model would look rigorous while
performing worse.

**Two methods**, both named in the spec: a 3-month recursive moving average and
a linear regression. **The choice between them is measured, not preferred**:
both are scored by mean absolute error on a 3-month holdout, and the lower one
is used. The scores and the reasoning are returned with the forecast. In
practice this picks different methods for different series — moving average for
total order volume, linear regression for several categories.

**SKU-level forecasts are refused.** The dataset holds **355 distinct SKUs
across 400 orders**: most appear once, none more than three times in a year.
Asked to predict demand for `PENCIL-0213`, the system lifts the request to the
`PENCIL` category and says so in the answer rather than returning a
confident-looking number fitted to three observations. Forecasts are available
at category, region, carrier and total level.

Each forecast returns the fitted history, the projection, the holdout scores,
an inventory recommendation (expected demand plus 1.645σ safety stock at a 95%
service level) and an explicit list of limitations.

---

## Deployment

**Frontend → Vercel.** Root directory `frontend`, build `npm run build`, output
`dist`. Set `VITE_API_BASE_URL` to the API's HTTPS URL.

**Backend → Docker on a VPS.** The compose file attaches the API to the
existing external `proxy-net` network, where the reverse proxy already running
on the host terminates TLS and routes to it. Nothing in this stack is published
to the internet directly.

```bash
cd backend
docker network create proxy-net     # only if it does not already exist
cp .env.example .env                # set real passwords and the API key
docker compose up -d --build
docker compose logs -f api
```

Compose brings up three services: `db` (Postgres 16, on an internal network,
published only on `127.0.0.1`), `seed` (one-shot — loads the CSV and creates
the read-only role, and the API waits for it to succeed) and `api`.

Then point the reverse proxy at `logistics-api:8000` on `proxy-net` and set
`CORS_ORIGINS` in `.env` to the exact Vercel origin. The frontend is served
over HTTPS, so the API must be too — a plain-HTTP backend is blocked by the
browser as mixed content.

> **Verified so far:** the compose file validates, and the application has been
> run against the exact file layout the image produces (`app/` and `data/` only,
> configured entirely from environment variables, no `.env` file present) with
> all endpoints responding. The image itself has **not** been built end-to-end,
> because Docker Hub is unreachable from the machine this was developed on.
> `docker compose up -d --build` is the first thing to run on the VPS.

---

## Tests

```bash
cd backend
docker compose up -d db && .venv/bin/python -m app.seed
.venv/bin/python -m pytest tests/ -q
# 58 passed
```

Tests run against a real Postgres, because the thing being tested is SQL.

- **`test_metrics.py`** — every metric is checked against a value computed by
  reading the CSV directly in the test, not by running the application. The
  average-delivery-time test explicitly asserts that the naive
  divide-by-400 answer is *not* produced.
- **`test_builder.py`** — the whitelist (invented metrics, dimensions, filter
  fields and operators are all rejected), relative-date resolution including
  the year boundary, and an injection attempt through a filter value that
  leaves the table intact.
- **`test_ai_router.py`** — routing, validation and execution driven by a fake
  client returning the tool call a model would have produced. Covers the
  unsupported-question path, rejection without retry, and the fact that the
  narration call cannot recompute.
- **`test_forecast.py`** — holdout scoring, non-negative forecasts, the SKU
  guard, and thin-group warnings.
- **`test_charts.py`** — chart-type selection for each result shape.

---

## Assumptions and simplifications

1. **On-time is derived from `status`.** There is no SLA date in the data. See
   [Metric definitions](#metric-definitions).
2. **`in_transit` and `canceled` are excluded from outcome rates** and from
   average delivery time — they have no outcome yet. They remain in
   `total_orders`, which counts every row.
3. **`client_id` is a filter dimension, not a tenant boundary.** The brief
   describes a single logistics client, so there is no per-client auth or data
   isolation.
4. **No authentication.** The brief does not require it and the data is mock.
   Adding login would have been scope without value here.
5. **Relative dates anchor to the dataset's newest order date**, not to today.
6. **`order_date` drives every time filter** — including questions phrased
   about deliveries. Filtering delayed orders "by week" groups them by the week
   they were ordered.
7. **The data is trusted as-is.** It was profiled before any code was written:
   `order_value_usd` equals `quantity × unit_price_usd` in all 400 rows, promo
   flags are consistent with discount percentages, and no lead time is
   negative. No cleaning layer was built because none is needed.
8. **Revenue is booked order value**, not shipped or collected revenue.
9. **No query cache.** 400 rows answer in single-digit milliseconds.

## Limitations and unsupported queries

**Not answerable, by design — the request is rejected rather than guessed:**

- Anything outside the columns: profit, margin, cost, shipping price, customer
  satisfaction, driver or vehicle data, weather.
- **Numeric filters** — "orders over $100", "quantity above 5". Filters cover
  categorical fields only. This is the most likely thing to want next; see
  below.
- **Per-SKU forecasts** — lifted to the SKU's category, with the substitution
  stated in the answer.
- More than two grouping dimensions, or more than one time bucket at a time.
- Joins or comparisons across two independent time windows in one question
  ("was Q4 better than Q3?" needs two questions today).
- Multi-turn conversation. Each question is answered independently; there is no
  follow-up context.

**Known rough edges:**

- The 12-month history makes every forecast indicative. The declining trend in
  the sample is a property of the mock data, not an established seasonality.
- Rankings over small carriers (GLS: 8 concluded orders) are not statistically
  meaningful. The system reports the sample size rather than hiding the
  problem, but it does not suppress the row.
- The narration call adds roughly a second of latency. It buys prose over
  numbers that are already on screen, which is a fair thing to cut.

## Future improvements

In the order I would actually do them:

1. **Numeric and range filters** in the semantic layer (`order_value > 100`,
   `quantity between 2 and 5`). The single most common thing a user will try
   that currently fails.
2. **Comparison queries** — a second time window in one `QuerySpec`, so
   "this month versus last" is one question and one chart.
3. **Follow-up context** — carry the previous `QuerySpec` into the next routing
   call so "and by region?" refines rather than restarts.
4. **Prompt caching** on the system prompt. It carries the full column
   vocabulary and is byte-identical across requests, so it is exactly the
   shape caching is for.
5. **A golden-question eval set** — 30 questions with expected `QuerySpec`
   outputs, run against the routing call in CI. Routing quality is currently
   verified by hand.
6. **Query-plan permalinks**, so a specific answer and its plan can be shared.
7. **Delivery-date-based time filtering** as an explicit option, for questions
   that are genuinely about when things arrived rather than when they were
   ordered.

---

## AI usage disclosure

This project was built with substantial AI assistance — Claude, via Claude Code
— and the brief asks for that to be stated, so here it is in full.

**What the AI did:** profiled the dataset before any code was written (that
profiling produced the findings that shaped the architecture — the 30 missing
delivery dates, the absent SLA column, the 355-SKUs-over-400-orders problem,
the small-sample carrier ranking); drafted the architecture; and wrote most of
the implementation, the tests and this README.

**What I did:** set the direction and made the calls that mattered — the split
between a semantic layer and text-to-SQL, the choice to derive on-time from
`status` and to exclude unconcluded orders, refusing SKU-level forecasts rather
than faking them, the deployment shape (Vercel plus Docker behind an existing
reverse proxy), and the decision not to build authentication or multi-tenancy.
I reviewed every file and verified the numbers independently.

**What was verified rather than trusted:** every metric is pinned in
`test_metrics.py` against a value computed from the CSV inside the test, so the
implementation and the expectation are derived independently. The read-only
role was confirmed by attempting `INSERT`, `UPDATE` and `DELETE` against it and
watching all three fail. The 58 tests pass against a real Postgres.

The application itself uses Claude at runtime for exactly one purpose: choosing
a tool and filling in its parameters, then writing prose over numbers it did
not compute.
# logistics-analytics-app
