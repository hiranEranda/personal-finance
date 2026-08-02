export interface PortfolioTicker {
  ticker: string;
  companyName: string;
  exchange: string;
  sector: string;
  currency: string;
  currentPrice: number;
  notes: string;
}

export interface PortfolioTrade {
  id: number;
  ticker: string;
  buyDate: string;
  qty: number;
  buyPrice: number;
  feesTotal: number; // stored for reference only — all cost math derives fees from settings feeRate
  notes: string;
  exchange?: string;
  feeBreakdown?: Record<string, number>;
}

export interface PortfolioSell {
  id: number;
  ticker: string;
  sellDate: string;
  qty: number;
  sellPrice: number;
  commission: number;
  notes: string;
}

export interface WeeklyPriceRow {
  weekEnding: string;
  prices: Record<string, number | null>;
}

export interface PortfolioSettings {
  sellSideFeeRate: number;
}

export interface PortfolioDocument {
  meta?: Record<string, unknown>;
  settings: PortfolioSettings;
  sectorList: string[];
  tickers: PortfolioTicker[];
  trades: PortfolioTrade[];
  sells: PortfolioSell[];
  weeklyPrices: WeeklyPriceRow[];
}

export interface Holding extends PortfolioTicker {
  qtyBought: number;
  qtySold: number;
  qtyHeld: number;
  grossInvested: number;
  feesPaid: number;
  totalCost: number;
  avgCost: number;
  marketValue: number;
  costBasisHeld: number;
  unrealizedPL: number;
  realizedPL: number;
  breakEvenPrice: number;
  weight: number;
  color: string;
}

export interface SectorSlice {
  sector: string;
  value: number;
  pct: number;
  color: string;
}

export interface WeeklySnapshot {
  weekEnding: string;
  portfolioValue: number;
  investedToDate: number;
}

// Returned by the share-parser service (Sync/Add buttons) — see
// share-parser/backend/sync_service.py, which builds this dict directly.
export interface ShareSyncSummary {
  scanned: number;
  trades_inserted: number;
  sells_inserted: number;
  tickers_created: number;
  skipped_duplicates: number;
  parse_errors: number;
}

export const PORTFOLIO_PALETTE = [
  '#0891b2',
  '#6366f1',
  '#f59e0b',
  '#f43f5e',
  '#10b981',
  '#8b5cf6',
  '#0ea5e9',
  '#ec4899',
];
