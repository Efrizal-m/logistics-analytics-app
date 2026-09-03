# --- build stage ------------------------------------------------------------
FROM python:3.12-slim AS builder

WORKDIR /app

RUN pip install --upgrade pip

COPY requirements.txt ./
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# --- runtime stage ----------------------------------------------------------
FROM python:3.12-slim

WORKDIR /app

# psycopg[binary] ships its own libpq, so no system packages are needed here.
COPY --from=builder /install /usr/local

COPY app ./app
COPY data ./data

RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
