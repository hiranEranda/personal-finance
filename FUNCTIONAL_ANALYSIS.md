# Investment Tracker — Functional Analysis

## Overview

Investment Tracker is a full-stack web application for managing and analysing a personal investment portfolio of mutual funds. It supports tracking transactions, monitoring fund performance, running statistical forecasts, and calculating tax liabilities. The stack is React (Vite) on the frontend and Express on the backend, with file-based CSV storage.

---

## Architecture

| Layer | Technology | Details |
|---|---|---|
| Frontend | React 19, Vite 7, React Router 7 | SPA with client-side routing |
| Styling | Tailwind CSS 3, CSS custom properties | Design-token system for theming |
| Charts | Recharts 3 | Area, Pie, Line charts |
| State | React Context + `useMemo` | `FundContext` as the single source of truth |
| Backend | Node.js + Express 5 | REST API on port 3001 |
| Persistence | CSV files (one per fund) + `nav_history.json` | No database — file system only |

---

## Application Routes

| Path | Page | Purpose |
|---|---|---|
| `/` | Dashboard | Portfolio snapshot — value, gain, KPIs, charts |
| `/analytics` | Analytics | Deep-dive metrics, risk, benchmarks, tax, dividends |
| `/forecast-settings` | Forecast Settings | SIP simulation and multi-model NAV forecasting |
| `/funds` | Funds | Read-only list of all funds |
| `/manage` | Manage Funds | CRUD for funds and transactions |
| `/fund/:id` | Fund Detail | Per-fund history, transactions, and analytics |

---

## Data Model

### Fund Object (in memory / context)

```json
{
  "id": "1758304345436",
  "name": "HDFC Flexi Cap Fund",
  "type": "Equity",
  "currentNav": 34.5,
  "transactions": [
    { "date": "2025-09-08", "amount": 10000, "nav": 33.67, "units": 296.96 }
  ],
  "navHistory": [{ "date": "2025-09", "nav": 33.67 }],
  "fundInfo": { "...": "metadata from nav_history.json" },
  "yearlyPerformance": { "...": "annual return data" }
}
```

### Derived Portfolio Data (computed in `AppInner`)

Each fund is enriched at render time with:
- `totalInvestment` — sum of all transaction amounts
- `totalUnits` — sum of all transaction units
- `currentValue` — `totalUnits × currentNav`
- `totalGain` — `currentValue − totalInvestment`
- `gainPercentage` — `(totalGain / totalInvestment) × 100`

### Totals Object

Portfolio-level aggregation across all funds:
```
{ totalInvestment, currentValue, totalGain, gainPercentage }
```

---

## Backend API

Base URL: `http://localhost:3001`

### `GET /api/funds`
- Reads all CSV files from `/server/database/active_funds/`
- Parses each into a fund object and returns the array

### `POST /api/funds`
- Accepts an array of fund objects
- Serialises each to a CSV file in `/active_funds/`
- Detects removed funds by comparing the payload against existing files
- Moves deleted fund CSVs to `/server/database/deleted_funds/` (soft delete / audit trail)

### `GET /api/nav-history`
- Returns the full contents of `/server/database/nav_history.json`
- Structure: `{ [fundId]: { monthly_performance: [...], fund_info: {...}, yearly_performance: {...} } }`

### CSV Format

```
id,name,type,currentNav
1758304345436,"HDFC Flexi Cap Fund",Equity,34.5

#Transactions
date,amount,nav,units
2025-09-08,10000,33.67,296.96
```

---

## State Management (`FundContext`)

Single context wraps the entire app. Responsible for:

| Concern | Detail |
|---|---|
| Load | Fetches funds + NAV history on mount, merges history into fund objects |
| Save | Auto-saves to backend with a 1-second debounce on any state change |
| CRUD | `addFund`, `editFund`, `deleteFund`, `updateFundTransactions` |
| Status | Exposes `loading`, `isSaving`, `error` for UI feedback |

A `SavingStatus` banner in the app shell shows save state and any server errors.

---

## Pages & Features

### Dashboard (`/`)

A bento-grid layout showing portfolio health at a glance.

| Component | Content |
|---|---|
| `BentoGrid` | Hero card (portfolio value, total gain, ROI trend), CAGR, IRR, ROI, Volatility mini-cards |
| `GrowthGraph` | Dual area-chart — invested amount vs current value over time, with time-range filters |
| `AllocationChart` | Pie chart of portfolio allocation by fund |
| `InvestmentList` | Scrollable list of funds with current value and gain % |

---

### Analytics (`/analytics`)

Multi-section deep dive. Has a fund selector to switch between portfolio-wide and per-fund view.

| Section | Metrics |
|---|---|
| Portfolio Performance | ROI, CAGR, IRR, Total Gain, Holding Period |
| Risk & Diversification | Volatility, Downside Deviation, Max Drawdown, Type allocation breakdown |
| Top / Underperformers | Top 3 and bottom 3 funds by ROI |
| Benchmark Comparison | Performance vs Global Equity (7%), Balanced (5%), Bond (3%) indices |
| Forecast | 1Y / 3Y / 5Y projections per fund and portfolio total |
| Tax Analysis | LTCG / STCG gains and tax liability by fund type |
| Dividend Analysis | Total dividends, annual yield, payout ratio |

---

### Manage Funds (`/manage`)

Full CRUD interface.

- **Fund list** with edit and delete actions
- **Fund form modal** — name, type (Equity / Debt / Income / Money Market / Hybrid)
- **Transaction management** — add, edit, delete transactions; units auto-calculated from `amount / nav`; current NAV auto-updated from the most recent transaction

---

### Fund Detail (`/fund/:id`)

Per-fund deep dive.

- Fund hero card with summary metrics
- Value growth chart with time-range filters (1M, 3M, 6M, 1Y, 5Y, All Time)
- Transaction history table
- Expandable analytics sections (same metrics as the analytics page, scoped to this fund)

---

### Forecast Settings (`/forecast-settings`)

SIP simulation and multi-model NAV forecasting.

- **Forecast horizon** — configurable years (default 5)
- **SIP inputs** — monthly contribution per fund, auto-initialised proportional to existing fund weights
- **Model selection** — Naive, Moving Average, Linear, Exponential, Logistic
- **View mode** — combined portfolio or individual funds
- Interactive charts: historical value, forecasted NAV trajectories, SIP accumulation

---

## Utilities

### `utils/analytics.js`

Core calculation engine. Two exported functions:

#### `calculateFundAnalytics(fund, currentDate)`

Computes all metrics for a single fund:

| Category | Metrics |
|---|---|
| Performance | ROI, CAGR, IRR (Newton-Raphson), holding years |
| Risk | Volatility (std dev of monthly returns), Downside Deviation, Max Drawdown |
| Forecast | 1Y / 3Y / 5Y projected values using best-fit model |
| Benchmark | Delta vs Global Equity, Balanced, Bond indices |
| Tax | LTCG / STCG gains and liabilities by holding period and fund type |
| Dividends | Total, annual (last 12 months), yield, payout ratio |

**Tax rules by fund type:**

| Type | Long-term threshold | LTCG rate | STCG rate |
|---|---|---|---|
| Equity | 365 days | 10% | 15% |
| Debt | 730 days | 20% | 30% |
| Hybrid | 365 days | 12% | 18% |

#### `calculatePortfolioAnalytics(funds, currentDate)`

Aggregates across all funds:
- Sums investment, value, gain
- Weighted risk metrics (weighted by fund value share)
- Diversification breakdown by fund type
- Consolidated forecast, tax, and dividend totals

---

### `utils/forecasting.js`

Five statistical models for NAV prediction:

| Model | Method |
|---|---|
| Naive | Last known value repeats |
| Moving Average | 3-period average |
| Linear Regression | Least-squares straight-line trend |
| Exponential Growth | `y = a(1+r)^x` |
| Logistic Growth | S-curve with a configurable capacity cap |

**`findBestFitModel(data, periods, capacity)`** — selects the best model via 80/20 train-test split, minimising MSE on the held-out 20%, then retrains on the full dataset.

Returns:
```json
{
  "model": "Linear",
  "mse": 0.0042,
  "forecast": [34.8, 35.1, 35.4, "...N values"]
}
```

---

### `utils/formatters.js`

| Function | Purpose |
|---|---|
| `formatNumber(value, decimals)` | Locale-aware number with separators |
| `formatCompact(value)` | Compact notation — K, L (lakh = 100K), Cr (crore = 10M) |
| `formatPercent(value, decimals)` | Percentage string with `%` suffix |
| `safeFormatNumber(value, decimals)` | `formatNumber` with graceful fallback for non-finite inputs |

---

## Theme System

- Two themes: **dark** and **light**, toggled via a button in the header
- Persisted in `localStorage` under the key `investment-tracker-theme`
- Implemented with CSS custom properties (`--color-bg`, `--color-text`, `--color-positive`, `--color-negative`, etc.)
- Tailwind utility classes reference these tokens (`token-card`, `token-number`, `token-positive`)

---

## Data Flow

```
App load
  └─ FundContext.useEffect
       ├─ GET /api/funds          → raw fund array
       └─ GET /api/nav-history    → enrichment data (navHistory, fundInfo, yearlyPerformance)
            └─ merged into funds state

User navigates pages
  └─ AppInner (useMemo)
       ├─ portfolioData  ← funds + calculated fields
       ├─ analytics      ← calculatePortfolioAnalytics(funds)
       └─ totals         ← sum across all funds
            └─ passed as props to each page

User edits (Manage Funds)
  └─ FundContext CRUD action → state update
       └─ debounced 1s → POST /api/funds
            └─ server writes CSV files
```

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Server not reachable on load | Error message displayed in `SavingStatus` banner |
| Save failure | "Failed to save changes" in banner; retried on next state change |
| Fund ID not found in detail route | 404 message rendered in `FundDetailView` |
| Non-finite analytics values | `safeFormatNumber` returns fallback; UI stays stable |

---

## Performance Considerations

- `useMemo` for `portfolioData`, `analytics`, and `totals` — recalculates only when `funds` changes
- 1-second debounce on save — prevents a POST per keystroke during transaction editing
- Recharts renders lazily inside the viewport
- NAV history enrichment happens once on load, not on every render

---

## Key Constraints & Assumptions

- **No authentication** — single-user, local-only application
- **No database** — all persistence is in flat CSV files; concurrent writes are not safe
- **Currency** — displays in Indian Rupee conventions (lakh / crore notation)
- **NAV history** — sourced from a static `nav_history.json`; not fetched from a live market API
- **IRR** — computed client-side via Newton-Raphson; may not converge for unusual cash-flow patterns
- **Tax rules** — hardcoded Indian mutual fund tax rules; not configurable at runtime
