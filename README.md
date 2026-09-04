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
- **AI** — Anthropic `claude-sonnet-5`, tool use only

---

## Glossary

| Term | Stands for | Used in this project for |
|---|---|---|
| AI | Artificial Intelligence | The model that routes questions to tools and narrates results — never computes numbers itself |
| API | Application Programming Interface | The FastAPI backend's HTTP endpoints under `/api/*` |
| CI | Continuous Integration | Where a future golden-question eval set would run (see [Future improvements](#future-improvements)) |
| CORS | Cross-Origin Resource Sharing | The browser policy that must allow the Vercel frontend to call the API on a different origin |
| CSV | Comma-Separated Values | The format of the seed dataset (`data/mock_logistics_data.csv`) |
| HMAC | Hash-based Message Authentication Code | Signs the session token so it can't be forged without `AUTH_SECRET`, without a server-side session store |
| HTTP / HTTPS | HyperText Transfer Protocol (Secure) | How the frontend talks to the API; HTTPS is required in production |
| IP | Internet Protocol | The per-client address the rate limiter (and the login brute-force guard) keys its quotas on |
| KPI | Key Performance Indicator | The headline numbers on the dashboard (total orders, on-time rate, etc.) |
| LRU | Least Recently Used | The eviction policy for the `/api/ask` answer cache once it's full |
| RAG | Retrieval-Augmented Generation | Retrieving text and putting it in the prompt so the model can answer from it — deliberately not used here, see [Technical notes](#technical-notes) |
| SKU | Stock Keeping Unit | A unique identifier for one product variant; too sparse per-SKU here to forecast directly, so forecasts are lifted to `product_category` |
| SLA | Service Level Agreement | A promised delivery date — absent from this dataset, which is why on-time is derived from `status` instead |
| SQL | Structured Query Language | What the query builder generates from validated parameters — the model never writes it |
| TLS | Transport Layer Security | The encryption terminated by the reverse proxy in front of the API |
| TTL | Time To Live | How long a cached response is kept before it's recomputed |
| UI | User Interface | The React frontend |
| URL | Uniform Resource Locator | e.g. `VITE_API_BASE_URL`, the address the frontend uses to reach the API |
| VPS | Virtual Private Server | Where the backend is deployed, behind an existing reverse proxy |

---

## Contents

- [Glossary](#glossary)
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
- [Technical notes](#technical-notes)
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
| `AUTH_ENABLED` / `AUTH_USERNAME` / `AUTH_PASSWORD` / `AUTH_SECRET` | A single shared login gating every endpoint except `/health`. See [Authentication](#authentication). |

Quote any `.env` value containing a space or `#` — `python-dotenv` treats an
unquoted `#` as a comment start, so an unquoted password containing one is
silently truncated rather than rejected.

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

### Authentication

A single shared login (`AUTH_USERNAME` / `AUTH_PASSWORD` in `.env`) gates
every endpoint except `/health` — the app has one logistics client and no
concept of separate accounts (see [Assumptions](#assumptions-and-simplifications)),
and `/api/ask` spends real, billed model calls, so leaving the API open to
anyone who finds the URL wasn't acceptable once it left localhost. There is no
users table: the API's Postgres role only holds `SELECT` on `orders`, and a
login table would need write access for one row of config, so credentials
live in `.env` beside `POSTGRES_PASSWORD` and `ANTHROPIC_API_KEY` instead.

A session is a stateless, HMAC-signed `{username, expiry}` token
(`AUTH_SECRET` signs it — generate with `openssl rand -hex 32`), sent as a
bearer token and held in the browser's `localStorage` for `AUTH_SESSION_HOURS`
(12 by default). Stateless means no server-side session store: a login
survives an API restart and works the same way whether the container runs one
worker or several. Logout is client-side only — it discards the local token,
but the token itself stays valid server-side until it expires on its own.
Rotating `AUTH_SECRET` is the only way to invalidate every session at once.

**Fails closed, not open.** If `AUTH_ENABLED` is true but the username,
password, or secret is missing — or the secret is shorter than 32
characters, too weak to resist forgery — every protected endpoint answers
`503` rather than quietly serving the app to anyone. This is the opposite of
how `ANTHROPIC_API_KEY` behaves: that one is allowed to default empty and
degrade the Ask tab gracefully, because an unconfigured login must never
silently mean "no login."

Auth is enforced as a FastAPI dependency, the same pattern the rate limiter
already used and for the same reason: a dependency's `HTTPException` travels
back out through `CORSMiddleware` and keeps the CORS header on the error
response, while middleware that short-circuits earlier would not — the exact
failure mode that made the frontend see an opaque "Failed to fetch" earlier in
this project. `/api/login` carries its own tighter rate limit
(`LOGIN_RATE_LIMIT_REQUESTS`, 5 per 15 minutes by default) as a brute-force
guard, independent of the dashboard/ask limits.

**Deployment order matters.** Enabling `AUTH_ENABLED=true` on the VPS while an
older, pre-login frontend build is still live on Vercel makes every request
401 with no login screen to recover through. Deploy the frontend first — it
handles both states — then set the `AUTH_*` variables and restart the API.
`docker compose up -d` (not `restart`) is required to pick up a `.env` change;
`docker compose restart api` does not re-read it. `AUTH_ENABLED=false` is the
rollback if the order slips.

### Rate limiting, caching, and `TRUSTED_PROXIES`

The API sits behind the reverse proxy above, so `request.client.host` is the
proxy's address, not the caller's — the app trusts `X-Forwarded-For` only from
addresses in `TRUSTED_PROXIES` (`.env.example`), walking the header
right-to-left to the first entry that isn't itself a trusted proxy. **This
must match wherever the reverse proxy actually runs**, or every client
collapses onto one shared rate-limit bucket: too narrow and the proxy's own
address falls outside it (the header gets ignored entirely — everyone shares
one bucket, keyed on the proxy); too wide and a client on that range can set
its own rate-limit identity via a forged header. The default
(`127.0.0.1,::1` plus the RFC1918 ranges) matches this project's Docker
deployment; narrowing it to just `proxy-net`'s own subnet is tighter for
production. Verify the assumption once with:

```bash
docker compose logs api | grep -oE '^INFO: *[0-9.]+' | sort -u
```

— every address printed there needs to fall inside `TRUSTED_PROXIES`, or the
`X-Forwarded-For` header is being silently ignored.

Two independent per-client-IP limits (`.env.example` has the full list):
`ASK_RATE_LIMIT_REQUESTS` per `ASK_RATE_LIMIT_WINDOW_SECONDS` on `/api/ask`
(10/hour by default — it spends real, billed model calls), and a much looser
`DASHBOARD_RATE_LIMIT_REQUESTS`/`..._WINDOW_SECONDS` on the GET endpoints
(60/min — a single page load fires ~6 requests). `/health` is never limited,
since Docker's own healthcheck polls it every 30s. A client over budget gets
`429` with a `Retry-After` header.

Dashboard responses and `/api/schema` are cached for `CACHE_TTL_SECONDS`
(default 300s; `0` disables expiry) — safe because the API's role only holds
`SELECT` and the dataset cannot change out from under a running process.
`/api/ask` is cached too, keyed on the question (case/whitespace-normalized)
and the configured model, capped at `ASK_CACHE_MAX_ENTRIES` distinct
questions (default 128, LRU-evicted; `0` disables it) — so asking the same
question twice costs one model call, not two. Re-running `python -m app.seed`
against a live `api` container is picked up within `CACHE_TTL_SECONDS`, or
immediately via `docker compose restart api`.

---

## Tests

```bash
cd backend
docker compose up -d db && .venv/bin/python -m app.seed
.venv/bin/python -m pytest tests/ -q
# 122 passed
```

Tests run against a real Postgres, because the thing being tested is SQL.
`test_ratelimit.py`, `test_cache.py` and `test_auth.py` are the exception —
pure units with no server and no database, so they run even when the Postgres
fixture above would skip the rest of the suite.

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
- **`test_kpis.py`** — that `kpi_trends` (which sources the KPI sparklines)
  stays out of the public preset list, and that a KPI's `direction` comes from
  the metric registry rather than being invented by the UI.
- **`test_ratelimit.py`** — token-bucket refill arithmetic against a faked
  clock, lossless eviction of refilled buckets vs. the LRU fallback, thread
  safety under concurrent access, and `client_key()`'s trusted-proxy /
  `X-Forwarded-For` resolution (including the case that motivated it — an
  untrusted peer cannot set its own rate-limit identity via the header).
- **`test_cache.py`** — cache hits/misses per key, that a failed computation
  is never cached, the `/api/ask` LRU cap, and that the TTL rollover clears
  every cache together (including `get_dataset_bounds`'s and the system
  prompt's, so a reseed can't leave one fresher than the other).
- **`test_auth.py`** — token mint/verify round-trip, rejection of an expired,
  tampered, or wrong-secret token with no exception escaping (the class of
  bug that would become a 500 slipping past `CORSMiddleware`), the credential
  check, and that `auth_configured` requires all three of username, password
  and a secret long enough to resist forgery.
- **`test_api.py`** — through FastAPI's `TestClient`: `/health` is exempt from
  auth and rate limiting, a `401` or `429` still carries the CORS header the
  browser needs to read it (the specific regression a middleware-based
  limiter or auth check would reintroduce), a garbage `Authorization` header
  is rejected cleanly rather than raising, login issues a token that actually
  unlocks the API, and the `/api/ask` cache actually reduces the number of
  model calls for equivalent questions.

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
4. **One shared login, not per-user accounts.** `client_id` is a filter
   dimension (point 3 above), not a tenant boundary, so there is nothing for
   separate accounts to isolate — a single credential pair gates access
   without pretending the app has users it doesn't. See
   [Authentication](#authentication).
5. **Relative dates anchor to the dataset's newest order date**, not to today.
6. **`order_date` drives every time filter** — including questions phrased
   about deliveries. Filtering delayed orders "by week" groups them by the week
   they were ordered.
7. **The data is trusted as-is.** It was profiled before any code was written:
   `order_value_usd` equals `quantity × unit_price_usd` in all 400 rows, promo
   flags are consistent with discount percentages, and no lead time is
   negative. No cleaning layer was built because none is needed.
8. **Revenue is booked order value**, not shipped or collected revenue.
9. **Caching is about model calls and request volume, not query speed.** 400
   rows answer in single-digit milliseconds; the response cache exists because
   `/api/ask` spends billed model calls and a page load fires ~6 requests. See
   [Rate limiting, caching, and `TRUSTED_PROXIES`](#rate-limiting-caching-and-trusted_proxies).

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

## Technical notes

Things this architecture deliberately does not use, and the conditions under
which each would earn its place. They come up in review often enough to be
worth writing down once, with the thresholds that would change the answer.

### Retrieval-augmented generation (RAG)

**Not used, and not applicable to the numbers.** RAG retrieves text and puts it
in a prompt so a model can answer from it. Here the model is never the thing
that answers — it picks a tool, and SQL computes the figure. Retrieving "the 20
orders most similar to the question" and asking a model to count them would
substitute approximation for arithmetic. On-time rate over 400 orders has to
consider all 400, not the ones nearest the phrasing; a delayed order is no less
delayed for being semantically distant from the word *delay*.

The other problem RAG solves — a schema too large to fit in a prompt — does not
exist at 12 metrics and 12 dimensions. The whole vocabulary is a few hundred
tokens and is byte-identical on every request.

**Where it would earn its place**, in increasing distance from where this
project stands:

1. **A vocabulary too large to enumerate.** The system prompt carries every
   distinct value of the seven low-cardinality columns, and already degrades
   where it cannot: `destination_city` gets a count and eight examples, `sku`
   gets its shape and cardinality instead of 355 literals. Push that to
   hundreds of metrics across many tables and the fix is to retrieve the
   relevant *slice of the semantic layer* per question — embed the metric and
   dimension definitions, retrieve the top matches for the question, build the
   tool schema from those. Note what is being retrieved: **the metadata, never
   the facts.** The figures still come from SQL over the full table. This is
   the version worth building, and it is a scaling technique for the prompt,
   not a change to how answers are computed.
2. **Genuinely unstructured columns.** This table has none — every column is an
   enum, a number or a date. Add free text (delivery exception notes, driver
   comments, support tickets) and *"why were the Jakarta deliveries late in
   March?"* stops being answerable by any amount of SQL. That is a real
   retrieval problem, and the shape is hybrid rather than replacement: the
   semantic layer answers *how many*, retrieval over the notes answers *why*,
   and the response keeps the two visibly separate so a retrieved anecdote is
   never read as a computed rate.
3. **A document corpus** — carrier contracts, SLA terms, ops runbooks. Then RAG
   is answering questions about documents, which is what it is for, and it sits
   beside the analytics path rather than inside it.

### Fine-tuning the routing model

**Not used.** Routing is a two-way classification with a fixed output schema,
which is not a shortage of model capability. More decisively, the vocabulary is
read from the database at first use, so the prompt tracks the data on its own —
a fine-tune would bake today's carrier names into weights and need retraining
every time a column gains a value. The prompt keeps that coupling live.

### What actually changes at 4 million rows

The AI path is the part that scales best: routing cost and latency are a
function of the question and the vocabulary, not of row count, so the two-call
shape is unchanged at any size. The data path is what gives way, roughly in
this order:

- **Indexes beyond the four that exist.** `order_date`, `status`, `carrier` and
  `product_category` are indexed today (`app/models.py`). The remaining filter
  columns are not, and neither are the composites that match how the app
  actually queries — a time range *and* a group-by, which is nearly every
  request. Reads move to a replica at the same time.
- **Pre-aggregation.** The KPIs and preset charts are the same handful of
  shapes on every page load, currently absorbed by `CACHE_TTL_SECONDS`. At
  scale that becomes a materialized rollup refreshed on ingest. The registry
  stays the single definition of each metric; a metric gains a second
  expression against the rollup, and `QueryPlan` has to report which one ran —
  otherwise the explainability contract quietly breaks, since "grouped by
  month, 12 rows" would no longer distinguish an exact answer from an
  approximate one.
- **The raw-row table becomes a sample.** `limit` caps at 1000 and the plan
  sheet shows the rows underneath an answer, which is honest at this size. At
  millions it is a sample and has to be labelled one.
- **`sample_size` inverts.** Today it exists so GLS's 8 concluded orders are
  not read as a trend. At scale every group clears any threshold and the useful
  addition is a confidence interval, not a bigger number.
- **The cache clock.** One process-wide generation with a 300s TTL works
  because the dataset is static and there is a single process. Continuous
  ingest across multiple workers means a shared cache keyed on an ingest
  watermark rather than a wall clock.
- **`client_id` becomes a boundary.** It is a filter dimension today
  ([Assumptions](#assumptions-and-simplifications)). Real multi-tenancy makes
  it row-level security on the read-only role — not a `WHERE` clause the
  application is trusted to remember to add.

---

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
watching all three fail. The 94 tests pass against a real Postgres.

The application itself uses Claude at runtime for exactly one purpose: choosing
a tool and filling in its parameters, then writing prose over numbers it did
not compute.
# logistics-analytics-app
