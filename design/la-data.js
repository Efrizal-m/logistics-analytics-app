/* Logistics Analytics — the dataset and copy the artboards render.
   Figures are the ones given in the brief; the monthly series are decomposed so
   they reconcile exactly (delivered 304 + delayed 55 + exception 11 = 370
   concluded; 400 total; 30 with no delivery_date). */
(function () {
  var M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var MONTHS = M.map(function (m) { return m + " 2025"; });

  var VOLUME = [31, 28, 35, 33, 36, 32, 38, 34, 30, 37, 33, 33];            // 400
  var DELIVERED = [24, 22, 27, 25, 28, 25, 29, 26, 23, 28, 25, 22];         // 304
  var DELAYED = [5, 4, 5, 6, 5, 4, 6, 5, 4, 5, 3, 3];                       // 55
  var EXCEPTION = [1, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 2];                     // 11
  var ONTIME = DELIVERED.map(function (d, i) {
    return Math.round((d / (d + DELAYED[i] + EXCEPTION[i])) * 1000) / 10;
  });
  var AVGDAYS = [4.1, 4.0, 3.9, 4.0, 3.8, 3.7, 3.9, 3.8, 3.6, 3.7, 3.6, 3.5];

  var CARRIERS = ["Meridian", "Northline", "Pacific", "Kestrel", "Bluewater", "Interlink", "Vantage", "Summit", "Redstone"];
  var CARRIER_CONCLUDED = [50, 51, 46, 38, 40, 38, 26, 31, 50];             // 370
  var CARRIER_DELAYED = [12, 10, 8, 6, 6, 5, 3, 3, 2];                      // 55
  var CARRIER_RATE = CARRIER_DELAYED.map(function (d, i) {
    return Math.round((d / CARRIER_CONCLUDED[i]) * 1000) / 10;
  });

  var CITIES = ["Chicago", "Los Angeles", "Houston", "Phoenix", "Philadelphia", "San Antonio", "Dallas", "San Diego", "Austin", "Jacksonville"];
  var CITY_ORDERS = [38, 34, 31, 28, 26, 24, 22, 19, 17, 15];

  var FC_HIST = [410, 388, 432, 455, 470, 441, 498, 476, 455, 512, 488, 503];
  var FC_NEXT = [512, 524, 537, 549];
  var FC_LABELS = MONTHS.concat(["Jan 2026", "Feb 2026", "Mar 2026", "Apr 2026"]);

  var KPI_SQL = `SELECT
  COUNT(*)                                                    AS total_orders,
  COUNT(*) FILTER (WHERE status = 'delivered')                 AS delivered_orders,
  COUNT(*) FILTER (WHERE status = 'delayed')                   AS delayed_orders,
  COUNT(*) FILTER (WHERE status = 'delivered')::float
    / NULLIF(COUNT(*) FILTER (
        WHERE status IN ('delivered','delayed','exception')), 0)
                                                               AS on_time_delivery_rate,
  AVG(delivery_date - order_date) FILTER (WHERE delivery_date IS NOT NULL)
                                                               AS avg_delivery_days
FROM orders
WHERE order_date BETWEEN DATE '2025-01-01' AND DATE '2025-12-30'
LIMIT 100`;

  var CARRIER_SQL = `SELECT
  carrier,
  COUNT(*) FILTER (WHERE status IN ('delivered','delayed','exception'))
                                                        AS concluded_orders,
  COUNT(*) FILTER (WHERE status = 'delayed')            AS delayed_orders,
  COUNT(*) FILTER (WHERE status = 'delayed')::float
    / NULLIF(COUNT(*) FILTER (
        WHERE status IN ('delivered','delayed','exception')), 0)
                                                        AS delay_rate
FROM orders
WHERE order_date BETWEEN DATE '2025-01-01' AND DATE '2025-12-30'
GROUP BY carrier
ORDER BY delay_rate DESC
LIMIT 100`;

  var VOLUME_SQL = `SELECT
  date_trunc('month', order_date)::date AS period,
  COUNT(*)                              AS total_orders
FROM orders
WHERE order_date BETWEEN DATE '2025-01-01' AND DATE '2025-12-30'
GROUP BY 1
ORDER BY 1
LIMIT 100`;

  window.LAData = {
    M: M,
    months: MONTHS,
    volume: VOLUME,
    delivered: DELIVERED,
    delayed: DELAYED,
    exception: EXCEPTION,
    ontime: ONTIME,
    avgDays: AVGDAYS,
    carriers: CARRIERS,
    carrierConcluded: CARRIER_CONCLUDED,
    carrierDelayed: CARRIER_DELAYED,
    carrierRate: CARRIER_RATE,
    cities: CITIES,
    cityOrders: CITY_ORDERS,
    forecast: {
      labels: FC_LABELS,
      history: FC_HIST,
      next: FC_NEXT,
      method: "holt linear",
      reason: "Twelve monthly points with a mild upward drift and no separable season, so a linear trend beat the alternatives on holdout.",
      mae: [["naive", "41.60"], ["seasonal naive", "38.20"], ["drift", "29.40"], ["holt linear", "24.80"]],
      stats: [
        ["Expected demand", "2,122", "units"],
        ["Safety stock", "318", "units"],
        ["Recommended units", "2,440", "units"],
        ["Horizon", "4", "months"]
      ],
      basis: "Expected demand is the sum of the four forecast months. Safety stock is 1.5 standard deviations of the holdout error scaled over the horizon. Recommended units is the sum of the two.",
      notes: [
        "Only 12 monthly observations, so seasonality cannot be separated from trend.",
        "PENCIL is 18% of order volume; a category this size moves on a handful of large orders."
      ],
      limitations: [
        "No promotional or price data, so demand shifts driven by pricing are invisible to the model.",
        "The holdout is the last three months only."
      ]
    },
    kpis: [
      {
        key: "total_orders", label: "Total orders", value: "400", format: "count",
        definition: "COUNT(*) over every row in orders within the dataset range. No status filter.",
        sample: null, series: VOLUME, unit: "orders",
        latest: "33", mean: "33.3", delta: "+2", deltaLabel: "Jan 31 → Dec 33", health: "none",
        healthNote: "Volume, not performance — no judgement applied."
      },
      {
        key: "delivered_orders", label: "Delivered orders", value: "304", format: "count",
        definition: "COUNT(*) WHERE status = 'delivered'. Counts the outcome, not the delivery date, so an order delivered late still counts as delivered.",
        sample: null, series: DELIVERED, unit: "orders",
        latest: "22", mean: "25.3", delta: "−2", deltaLabel: "Jan 24 → Dec 22", health: "none",
        healthNote: "Volume, not performance — no judgement applied."
      },
      {
        key: "delayed_orders", label: "Delayed orders", value: "55", format: "count",
        definition: "COUNT(*) WHERE status = 'delayed'. An order is delayed when it concluded after its promised_date.",
        sample: null, series: DELAYED, unit: "orders",
        latest: "3", mean: "4.6", delta: "−2", deltaLabel: "Jan 5 → Dec 3", health: "none",
        healthNote: "December 3 is below the monthly mean of 4.6 — no adverse mark."
      },
      {
        key: "on_time_delivery_rate", label: "On-time delivery rate", value: "82.2%", format: "percent",
        definition: "delivered / (delivered + delayed + exception). Orders still in transit or canceled have no outcome and are excluded from the denominator.",
        sample: "over 370 concluded orders", series: ONTIME, unit: "%",
        latest: "81.5%", mean: "82.2", delta: "+1.5 pts", deltaLabel: "Jan 80.0% → Dec 81.5%", health: "warn",
        healthNote: "December 81.5% sits 0.7 pts below the period figure of 82.2%."
      },
      {
        key: "avg_delivery_days", label: "Average delivery time", value: "3.8 days", format: "days",
        definition: "AVG(delivery_date - order_date) over orders that have a delivery_date. 30 of 400 orders are excluded.",
        sample: null, series: AVGDAYS, unit: "days",
        latest: "3.5", mean: "3.8", delta: "−0.6 days", deltaLabel: "Jan 4.1 → Dec 3.5", health: "none",
        healthNote: "December 3.5 days is below the period figure of 3.8 — no adverse mark."
      }
    ],
    charts: [
      {
        key: "orders_over_time", title: "Order volume by month", type: "Line",
        why: "One measure over twelve consecutive months: a line carries the shape of the trend, which separated bars break up.",
        plan: "1 metric · grouped by month · no filters · 12 rows"
      },
      {
        key: "delivery_performance", title: "Delivery outcomes by month", type: "Multi-series line",
        why: "Three outcomes share one count scale, so parallel lines let them be compared month by month without stacking hiding the smallest.",
        plan: "3 metrics · grouped by month · no filters · 12 rows"
      },
      {
        key: "carrier_breakdown", title: "Delay rate by carrier", type: "Vertical bar",
        why: "Nine unordered categories on one percentage scale: bar length is the most accurate comparison a reader can make.",
        plan: "1 metric · grouped by carrier · no filters · 9 rows"
      },
      {
        key: "destination_breakdown", title: "Orders by destination city (top 10)", type: "Horizontal bar",
        why: "Ten long place names need room to be read, so the categories run down the left and the bars run across.",
        plan: "1 metric · grouped by city · top 10 · 10 rows"
      }
    ],
    kpiPlan: {
      title: "How this was calculated",
      metrics: ["Total orders", "Delivered orders", "Delayed orders", "On-time delivery rate", "Average delivery time"],
      groupBy: null,
      groupByNone: "Not grouped — one row for the whole selection",
      filters: null,
      filtersNone: "None — all orders",
      timeRange: "2025-01-01 to 2025-12-30",
      anchor: "dataset bounds",
      result: "1 row · limit 100",
      notes: [
        "30 of 400 orders have no delivery_date and are excluded from average delivery time.",
        "Orders in transit or canceled are excluded from the on-time rate denominator."
      ],
      sql: KPI_SQL,
      rowLabel: "Underlying data (1 row)",
      cols: [["Total Orders", 1], ["Delivered Orders", 1], ["Delayed Orders", 1], ["On Time Delivery Rate", 1], ["Avg Delivery Days", 1]],
      rows: [["400", "304", "55", "0.8216", "3.8027"]]
    },
    volumePlan: {
      metrics: ["Total orders"],
      groupBy: ["Month"],
      filters: null,
      filtersNone: "None — all orders",
      timeRange: "2025-01-01 to 2025-12-30",
      anchor: "dataset bounds",
      result: "12 rows · sorted by period asc · limit 100",
      notes: ["December is a partial month: the dataset ends 2025-12-30."],
      sql: VOLUME_SQL,
      rowLabel: "Underlying data (12 rows)",
      cols: [["Period", 0], ["Total Orders", 1]],
      rows: MONTHS.map(function (m, i) { return [m, String(VOLUME[i])]; })
    },
    carrierPlan: {
      metrics: ["Delay rate"],
      groupBy: ["Carrier"],
      filters: null,
      filtersNone: "None — all orders",
      timeRange: "2025-01-01 to 2025-12-30",
      anchor: "dataset bounds",
      result: "9 rows · sorted by delay_rate desc · limit 100",
      notes: [
        "Vantage has 26 concluded orders; at that size one order moves the rate by roughly 4 points.",
        "Orders in transit or canceled are excluded from every carrier's denominator."
      ],
      sql: CARRIER_SQL,
      rowLabel: "Underlying data (9 rows)",
      cols: [["Carrier", 0], ["Concluded Orders", 1], ["Delayed Orders", 1], ["Delay Rate", 1]],
      rows: CARRIERS.map(function (c, i) {
        return [c, String(CARRIER_CONCLUDED[i]), String(CARRIER_DELAYED[i]),
          (CARRIER_DELAYED[i] / CARRIER_CONCLUDED[i]).toFixed(4)];
      }),
      toolInput: `{
  "metrics": ["delay_rate"],
  "group_by": ["carrier"],
  "filters": [],
  "time_range": null,
  "sort": "delay_rate desc",
  "limit": 100,
  "chart_type": "bar"
}`
    },
    forecastPlan: {
      metrics: ["Total quantity"],
      groupBy: ["Month"],
      filters: ["category is PENCIL"],
      filtersNone: null,
      timeRange: "2025-01-01 to 2025-12-30",
      anchor: "dataset bounds, forecast anchored on the last complete month",
      result: "12 rows · sorted by period asc · limit 100",
      notes: ["The forecast is computed on the server from these 12 rows; it is not part of the query result."],
      sql: `SELECT
  date_trunc('month', order_date)::date AS period,
  SUM(quantity)                         AS total_quantity
FROM orders
WHERE category = 'PENCIL'
  AND order_date BETWEEN DATE '2025-01-01' AND DATE '2025-12-30'
GROUP BY 1
ORDER BY 1
LIMIT 100`,
      rowLabel: "Underlying data (12 rows)",
      cols: [["Period", 0], ["Total Quantity", 1]],
      rows: MONTHS.map(function (m, i) { return [m, String(FC_HIST[i])]; }),
      toolInput: `{
  "grain": "category",
  "grain_value": "PENCIL",
  "metric": "total_quantity",
  "horizon_months": 4
}`
    },
    metricDefs: {
      "Total orders": "COUNT(*) over every row in orders within the dataset range. No status filter.",
      "Delivered orders": "COUNT(*) WHERE status = 'delivered'. Counts the outcome, not the delivery date, so an order delivered late still counts as delivered.",
      "Delayed orders": "COUNT(*) WHERE status = 'delayed'. An order is delayed when it concluded after its promised_date.",
      "On-time delivery rate": "delivered / (delivered + delayed + exception). Orders still in transit or canceled have no outcome and are excluded from the denominator.",
      "Average delivery time": "AVG(delivery_date - order_date) over orders that have a delivery_date. 30 of 400 orders are excluded.",
      "Delay rate": "delayed / (delivered + delayed + exception), per group. Same denominator rule as the on-time rate, so the two always sum with the exception share to 1.",
      "Total quantity": "SUM(quantity) over the matching orders. Counts units ordered, not units delivered."
    },
    examples: [
      "Show delayed orders by week for the last 3 months",
      "Which carrier has the highest delay rate?",
      "How many orders were delivered late last month?",
      "What is the on-time delivery rate by region?",
      "Average delivery time by warehouse",
      "Predict demand for the PENCIL category for the next 4 months"
    ],
    answers: {
      carrier: {
        question: "Which carrier has the highest delay rate?",
        prose: [
          "Meridian has the highest delay rate at 24.0% — twelve of its fifty concluded orders arrived after the promised date. That is nine points above the fleet figure of 14.9% and more than four points clear of the next carrier, Northline at 19.6%.",
          "Redstone is the most reliable at 4.0% on a comparable book of fifty orders, so the spread across the fleet is real rather than a volume artefact. Vantage sits mid-table at 11.5% but on only twenty-six concluded orders, where a single order moves the rate about four points."
        ],
        chartTitle: "Delay rate by carrier",
        chartWhy: "Nine unordered categories on one percentage scale: bar length is the most accurate comparison a reader can make."
      },
      unsupported: {
        question: "Which sales rep closed the most revenue?",
        prose: [
          "This dataset has no revenue, price, or owner columns. It holds orders with a carrier, warehouse, destination city and region, product category, quantity, and the order, promised and delivery dates — so there is nothing here that could stand in for a sales figure or a person.",
          "Rather than approximate it with quantity, which would answer a different question, the query builder rejected the request. Below are the nearest questions this dataset can answer."
        ],
        fallbacks: [
          "Average delivery time by warehouse",
          "What is the on-time delivery rate by region?",
          "Which carrier has the highest delay rate?"
        ]
      },
      forecast: {
        question: "Predict demand for the PENCIL category for the next 4 months",
        prose: [
          "PENCIL demand ran at 502 units a month across the fourth quarter against a twelve-month average of 452, continuing a mild upward drift that has held since March. Projecting that trend forward gives 2,122 units over the next four months, rising from 512 in January to 549 in April.",
          "Holding 2,440 units covers that expectation plus a 318-unit buffer sized on the model's own holdout error. The trend model was the most accurate of the four tested, but on twelve monthly observations no method can separate seasonality from drift — treat the four-month total as more reliable than any single month in it."
        ],
        title: "Units — PENCIL"
      }
    }
  };
})();
