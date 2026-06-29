export interface Transaction {
  date: string;
  amount: number;
  nav: number;
  units: number;
}

export interface NavHistoryEntry {
  date: string;
  nav: number;
}

export interface Fund {
  id: string;
  name: string;
  type: 'Equity' | 'Debt' | 'Hybrid' | 'Income' | 'Money Market';
  currentNav: number;
  transactions: Transaction[];
  navHistory?: NavHistoryEntry[];
  fundInfo?: Record<string, unknown>;
  yearlyPerformance?: Record<string, unknown>;
  dividends?: { date: string; amount: number }[];
}

export interface PortfolioFund extends Fund {
  totalInvestment: number;
  totalUnits: number;
  currentValue: number;
  totalGain: number;
  gainPercentage: number;
}

export interface RiskMetrics {
  volatility: number;
  downsideDeviation: number;
  maxDrawdown: number;
  returnSeries: number[];
}

export interface BenchmarkComparison {
  name: string;
  expectedValue: number;
  difference: number;
  relativePerformance: number;
}

export interface ForecastResult {
  growthAssumption: number;
  modelUsed: string;
  mse: number;
  oneYear: number;
  threeYear: number;
  fiveYear: number;
}

export interface TaxData {
  longTermGain: number;
  shortTermGain: number;
  longTermTax: number;
  shortTermTax: number;
  totalPotentialTax: number;
}

export interface DividendData {
  totalDividends: number;
  annualDividend: number;
  dividendYield: number;
  payoutRatio: number;
  lastDividendDate: Date | null;
}

export interface FundAnalytics {
  fundId: string;
  name: string;
  type: string;
  totalInvestment: number;
  totalUnits: number;
  currentValue: number;
  totalGain: number;
  roi: number;
  cagr: number;
  irr: number;
  holdingYears: number;
  risk: RiskMetrics;
  benchmarkComparisons: BenchmarkComparison[];
  forecast: ForecastResult;
  tax: TaxData;
  dividends: DividendData;
  growthAssumption: number;
  projectedAnnualContribution: number;
}

export interface DiversificationItem {
  type: string;
  investment: number;
  value: number;
  allocation: number;
}

export interface PortfolioSummary {
  totalInvestment: number;
  currentValue: number;
  totalGain: number;
  roi: number;
  cagr: number;
  holdingYears: number;
  irr: number;
}

export interface PortfolioAnalytics {
  funds: FundAnalytics[];
  portfolio: PortfolioSummary;
  diversification: DiversificationItem[];
  benchmarks: BenchmarkComparison[];
  risk: { volatility: number; downsideDeviation: number; maxDrawdown: number };
  forecast: {
    total: { oneYear: number; threeYear: number; fiveYear: number };
    perFund: { fundId: string; name: string; growthAssumption: number; oneYear: number; threeYear: number; fiveYear: number }[];
  };
  tax: { longTermTax: number; shortTermTax: number; longTermGain: number; shortTermGain: number };
  dividends: { totalDividends: number; annualDividend: number; dividendYield: number };
}

export interface Totals {
  totalInvestment: number;
  currentValue: number;
  totalGain: number;
}
