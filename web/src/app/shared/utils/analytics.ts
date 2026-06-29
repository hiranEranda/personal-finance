import { findBestFitModel } from './forecasting';
import { Fund, PortfolioFund, FundAnalytics, PortfolioAnalytics } from '../types/fund.types';

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const DAYS_PER_YEAR = 365.25;

const BENCHMARK_INDICES = [
  { name: 'Global Equity Index', annualReturn: 0.07 },
  { name: 'Balanced Market Index', annualReturn: 0.05 },
  { name: 'Bond Aggregate Index', annualReturn: 0.03 },
];

const DEFAULT_TAX_RULE = { longTermDays: 365, longTermRate: 0.1, shortTermRate: 0.15 };
const TAX_RULES: Record<string, typeof DEFAULT_TAX_RULE> = {
  Equity: DEFAULT_TAX_RULE,
  Debt: { longTermDays: 730, longTermRate: 0.2, shortTermRate: 0.3 },
  Hybrid: { longTermDays: 365, longTermRate: 0.12, shortTermRate: 0.18 },
};

const annualizeReturn = (totalReturn: number, years: number): number => {
  if (!Number.isFinite(totalReturn) || !Number.isFinite(years) || years <= 0) return 0;
  return Math.pow(1 + totalReturn, 1 / years) - 1;
};

const yearsBetween = (start: string | Date, end: Date): number => {
  const startDate = new Date(start);
  if (isNaN(startDate.getTime()) || isNaN(end.getTime())) return 0;
  return (end.getTime() - startDate.getTime()) / MS_PER_DAY / DAYS_PER_YEAR;
};

const standardDeviation = (values: number[]): number => {
  if (!values || values.length < 2) return 0;
  const avg = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / (values.length - 1);
  return Math.sqrt(variance);
};

const maxDrawdownFromSeries = (series: number[]): number => {
  if (!series || series.length === 0) return 0;
  let peak = series[0];
  let maxDrawdown = 0;
  series.forEach(value => {
    if (value > peak) peak = value;
    if (peak > 0) {
      const drawdown = (value - peak) / peak;
      if (drawdown < maxDrawdown) maxDrawdown = drawdown;
    }
  });
  return Math.abs(maxDrawdown);
};

const getTaxRuleForType = (type: string) => TAX_RULES[type] || DEFAULT_TAX_RULE;

const aggregateDividends = (dividends: { date: string; amount: number }[] | undefined) => {
  if (!Array.isArray(dividends)) return { totalDividends: 0, lastDividendDate: null, last12MonthsDividends: 0 };
  const totalDividends = dividends.reduce((sum, entry) => sum + (entry.amount || 0), 0);
  let lastDividendDate: Date | null = null;
  let last12MonthsDividends = 0;
  const now = new Date();
  dividends.forEach(entry => {
    const dividendDate = new Date(entry.date);
    if (isNaN(dividendDate.getTime())) return;
    if (!lastDividendDate || dividendDate > lastDividendDate) lastDividendDate = dividendDate;
    if ((now.getTime() - dividendDate.getTime()) / MS_PER_DAY <= 365) last12MonthsDividends += entry.amount || 0;
  });
  return { totalDividends, lastDividendDate, last12MonthsDividends };
};

const computeBenchmarkValue = (transactions: Fund['transactions'], benchmarkRate: number, currentDate: Date): number => {
  if (!Array.isArray(transactions) || transactions.length === 0) return 0;
  return transactions.reduce((sum, t) => {
    const years = yearsBetween(t.date, currentDate);
    return sum + (t.amount || 0) * Math.pow(1 + benchmarkRate, Math.max(years, 0));
  }, 0);
};

const computeForecastValue = (params: { currentValue: number; annualRate: number; years: number; projectedAnnualContribution: number }): number => {
  const { currentValue, annualRate, years, projectedAnnualContribution } = params;
  if (!Number.isFinite(currentValue) || currentValue < 0) return 0;
  const rate = Number.isFinite(annualRate) ? annualRate : 0;
  const principalGrowth = currentValue * Math.pow(1 + rate, years);
  if (!projectedAnnualContribution || rate === 0) return principalGrowth + (projectedAnnualContribution || 0) * years;
  return principalGrowth + projectedAnnualContribution * ((Math.pow(1 + rate, years) - 1) / rate);
};

const computeIRR = (transactions: Fund['transactions'], currentValue: number, currentDate: Date): number => {
  const cashflows: { amount: number; date: Date }[] = [];
  transactions.forEach(t => {
    const date = new Date(t.date);
    if (!isNaN(date.getTime())) cashflows.push({ amount: -(t.amount || 0), date });
  });
  cashflows.push({ amount: currentValue, date: currentDate });
  if (cashflows.length < 2) return 0;

  const minDate = cashflows.reduce((earliest, flow) =>
    earliest && earliest < flow.date ? earliest : flow.date, cashflows[0].date);

  let rate = 0.08;
  for (let iteration = 0; iteration < 20; iteration++) {
    let npv = 0;
    let derivative = 0;
    cashflows.forEach(flow => {
      const years = (flow.date.getTime() - minDate.getTime()) / MS_PER_DAY / DAYS_PER_YEAR;
      const discountFactor = Math.pow(1 + rate, years);
      npv += flow.amount / discountFactor;
      if (discountFactor !== 0) derivative -= (years * flow.amount) / (discountFactor * (1 + rate));
    });
    if (Math.abs(npv) < 1e-6) break;
    if (derivative === 0) return rate;
    rate -= npv / derivative;
    if (!Number.isFinite(rate)) { rate = 0.08; break; }
  }
  return Number.isFinite(rate) ? rate : 0;
};

const getMonthlyNavSeries = (fund: PortfolioFund | Fund, currentDate: Date): number[] => {
  const navHistory = Array.isArray(fund.navHistory) ? fund.navHistory : [];
  const transactions = Array.isArray(fund.transactions) ? fund.transactions : [];
  const currentNav = fund.currentNav || 0;
  const cutoff = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);

  if (navHistory.length > 0) {
    const sorted = [...navHistory]
      .map(e => ({ date: new Date(e.date), nav: e.nav }))
      .filter(e => e.date < cutoff && e.nav > 0)
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    const coveredMonths = new Set(sorted.map(e => `${e.date.getFullYear()}-${e.date.getMonth()}`));
    transactions.forEach(t => {
      const d = new Date(t.date);
      const monthKey = `${d.getFullYear()}-${d.getMonth()}`;
      if (!coveredMonths.has(monthKey) && t.nav > 0 && d < cutoff) {
        sorted.push({ date: new Date(d.getFullYear(), d.getMonth(), 1), nav: t.nav });
        coveredMonths.add(monthKey);
      }
    });

    if (currentNav > 0) {
      const currentMonthKey = `${currentDate.getFullYear()}-${currentDate.getMonth()}`;
      if (!coveredMonths.has(currentMonthKey)) {
        sorted.push({ date: new Date(currentDate.getFullYear(), currentDate.getMonth(), 1), nav: currentNav });
      }
    }

    sorted.sort((a, b) => a.date.getTime() - b.date.getTime());
    return sorted.map(e => e.nav);
  }

  if (transactions.length === 0) return [currentNav || 10];
  const sortedTxns = [...transactions].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const start = new Date(sortedTxns[0].date);
  const end = new Date(currentDate);
  const monthlyNavs: number[] = [];
  let ptr = 0;

  for (let d = new Date(start); d <= end; d.setMonth(d.getMonth() + 1)) {
    while (ptr < sortedTxns.length - 1 && new Date(sortedTxns[ptr + 1].date) <= d) ptr++;
    const t1 = sortedTxns[ptr];
    const t2 = sortedTxns[ptr + 1];
    let nav = t1.nav;
    if (t2) {
      const ratio = (d.getTime() - new Date(t1.date).getTime()) / (new Date(t2.date).getTime() - new Date(t1.date).getTime());
      nav = t1.nav + (t2.nav - t1.nav) * Math.max(0, Math.min(1, ratio));
    } else if (currentNav && d.getTime() > new Date(t1.date).getTime()) {
      const date1 = new Date(t1.date).getTime();
      const date2 = end.getTime();
      const now = d.getTime();
      if (date2 > date1) {
        nav = t1.nav + (currentNav - t1.nav) * Math.max(0, Math.min(1, (now - date1) / (date2 - date1)));
      } else {
        nav = currentNav;
      }
    }
    monthlyNavs.push(nav);
  }

  if (monthlyNavs.length < 2) return [currentNav || 10, currentNav || 10];
  return monthlyNavs;
};

export const calculateFundAnalytics = (fund: PortfolioFund, currentDate: Date = new Date()): FundAnalytics => {
  const transactions = Array.isArray(fund.transactions) ? fund.transactions : [];
  const sortedTransactions = [...transactions].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const earliestTransactionDate = sortedTransactions[0]?.date;
  const holdingYears = earliestTransactionDate ? yearsBetween(earliestTransactionDate, currentDate) : 0;

  const totalInvestment = transactions.reduce((sum, t) => sum + (t.amount || 0), 0);
  const totalUnits = transactions.reduce((sum, t) => sum + (t.units || 0), 0);
  const currentValue = fund.currentValue || totalUnits * (fund.currentNav || 0);
  const totalGain = currentValue - totalInvestment;
  const roi = totalInvestment > 0 ? totalGain / totalInvestment : 0;
  const cagr = totalInvestment > 0 && holdingYears > 0 ? annualizeReturn(currentValue / totalInvestment - 1, holdingYears) : 0;

  const monthlyNavData = getMonthlyNavSeries(fund, currentDate);
  const bestFit = findBestFitModel(monthlyNavData, 60);
  const predictedNavs = bestFit.forecast;

  const oneYearNav = predictedNavs[11] || predictedNavs[predictedNavs.length - 1];
  const threeYearNav = predictedNavs[35] || predictedNavs[predictedNavs.length - 1];
  const fiveYearNav = predictedNavs[59] || predictedNavs[predictedNavs.length - 1];

  const forecast = {
    growthAssumption: cagr || 0.05,
    modelUsed: bestFit.model,
    mse: bestFit.mse || 0,
    oneYear: Number.isFinite(oneYearNav * totalUnits) ? oneYearNav * totalUnits : currentValue * 1.05,
    threeYear: Number.isFinite(threeYearNav * totalUnits) ? threeYearNav * totalUnits : currentValue * 1.15,
    fiveYear: Number.isFinite(fiveYearNav * totalUnits) ? fiveYearNav * totalUnits : currentValue * 1.25,
  };

  const navHistory = Array.isArray(fund.navHistory) ? fund.navHistory : [];
  let navReturns: number[] = [];

  if (navHistory.length >= 2) {
    const sortedHist = [...navHistory].filter(e => e.nav > 0).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    for (let i = 1; i < sortedHist.length; i++) {
      const prev = sortedHist[i - 1].nav;
      const curr = sortedHist[i].nav;
      if (prev > 0 && curr > 0) navReturns.push((curr - prev) / prev);
    }
  } else {
    const navSeries = [...sortedTransactions.map(t => t.nav || 0)];
    if (fund.currentNav) navSeries.push(fund.currentNav);
    for (let i = 1; i < navSeries.length; i++) {
      const prev = navSeries[i - 1];
      const curr = navSeries[i];
      if (prev > 0 && curr > 0) navReturns.push((curr - prev) / prev);
    }
  }

  const vol = standardDeviation(navReturns);
  const downDev = standardDeviation(navReturns.filter(v => v < 0));
  const navSeriesForDD = navHistory.length >= 2
    ? navHistory.filter(e => e.nav > 0).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()).map(e => e.nav)
    : [...sortedTransactions.map(t => t.nav || 0), fund.currentNav || 0].filter(v => v > 0);
  const maxDD = maxDrawdownFromSeries(navSeriesForDD);

  const benchmarkComparisons = BENCHMARK_INDICES.map(benchmark => {
    const expectedValue = computeBenchmarkValue(sortedTransactions, benchmark.annualReturn, currentDate);
    return {
      name: benchmark.name,
      expectedValue,
      difference: currentValue - expectedValue,
      relativePerformance: expectedValue > 0 ? (currentValue - expectedValue) / expectedValue : 0,
    };
  });

  const projectedAnnualContribution = holdingYears > 0 ? totalInvestment / holdingYears : totalInvestment;
  const growthAssumption = cagr || roi || 0.05;

  const taxRule = getTaxRuleForType(fund.type);
  let longTermGain = 0;
  let shortTermGain = 0;
  transactions.forEach(t => {
    const units = t.units || 0;
    const costBasis = (t.nav || 0) * units;
    const currentProceeds = (fund.currentNav || 0) * units;
    const gain = currentProceeds - costBasis;
    if (gain <= 0) return;
    const holdingDays = yearsBetween(t.date, currentDate) * DAYS_PER_YEAR;
    if (holdingDays >= taxRule.longTermDays) longTermGain += gain;
    else shortTermGain += gain;
  });

  const dividendData = aggregateDividends(fund.dividends);
  const dividendYield = currentValue > 0 ? dividendData.last12MonthsDividends / currentValue : 0;
  const payoutRatio = totalInvestment > 0 ? dividendData.totalDividends / totalInvestment : 0;
  const irr = computeIRR(sortedTransactions, currentValue, currentDate);

  return {
    fundId: fund.id,
    name: fund.name,
    type: fund.type,
    totalInvestment,
    totalUnits,
    currentValue,
    totalGain,
    roi,
    cagr,
    holdingYears,
    risk: { volatility: vol, downsideDeviation: downDev, maxDrawdown: maxDD, returnSeries: navReturns },
    benchmarkComparisons,
    forecast,
    tax: {
      longTermGain,
      shortTermGain,
      longTermTax: longTermGain * taxRule.longTermRate,
      shortTermTax: shortTermGain * taxRule.shortTermRate,
      totalPotentialTax: longTermGain * taxRule.longTermRate + shortTermGain * taxRule.shortTermRate,
    },
    dividends: {
      totalDividends: dividendData.totalDividends,
      annualDividend: dividendData.last12MonthsDividends,
      dividendYield,
      payoutRatio,
      lastDividendDate: dividendData.lastDividendDate,
    },
    irr,
    growthAssumption,
    projectedAnnualContribution,
  };
};

export const calculatePortfolioAnalytics = (funds: PortfolioFund[], currentDate: Date = new Date()): PortfolioAnalytics => {
  const empty: PortfolioAnalytics = {
    funds: [],
    portfolio: { totalInvestment: 0, currentValue: 0, totalGain: 0, roi: 0, cagr: 0, holdingYears: 0, irr: 0 },
    diversification: [],
    benchmarks: [],
    risk: { volatility: 0, downsideDeviation: 0, maxDrawdown: 0 },
    forecast: { total: { oneYear: 0, threeYear: 0, fiveYear: 0 }, perFund: [] },
    tax: { longTermTax: 0, shortTermTax: 0, longTermGain: 0, shortTermGain: 0 },
    dividends: { totalDividends: 0, annualDividend: 0, dividendYield: 0 },
  };

  if (!Array.isArray(funds) || funds.length === 0) return empty;

  const fundAnalytics = funds.map(f => calculateFundAnalytics(f, currentDate));
  const totalInvestment = fundAnalytics.reduce((sum, f) => sum + f.totalInvestment, 0);
  const currentValue = fundAnalytics.reduce((sum, f) => sum + f.currentValue, 0);
  const totalGain = currentValue - totalInvestment;

  const allDates = funds.flatMap(f => (f.transactions || []).map(t => t.date)).filter(Boolean).sort();
  const holdingYears = allDates.length ? yearsBetween(allDates[0], currentDate) : 0;
  const roi = totalInvestment > 0 ? totalGain / totalInvestment : 0;
  const cagr = totalInvestment > 0 && holdingYears > 0 ? annualizeReturn(currentValue / totalInvestment - 1, holdingYears) : 0;

  const diversificationMap = new Map<string, { type: string; investment: number; value: number }>();
  fundAnalytics.forEach(f => {
    const key = f.type || 'Unspecified';
    const existing = diversificationMap.get(key) || { type: key, investment: 0, value: 0 };
    existing.investment += f.totalInvestment;
    existing.value += f.currentValue;
    diversificationMap.set(key, existing);
  });
  const diversification = Array.from(diversificationMap.values()).map(e => ({
    ...e, allocation: currentValue > 0 ? e.value / currentValue : 0,
  }));

  const wVol = fundAnalytics.reduce((s, f) => s + (currentValue > 0 ? f.currentValue / currentValue : 0) * f.risk.volatility, 0);
  const wDown = fundAnalytics.reduce((s, f) => s + (currentValue > 0 ? f.currentValue / currentValue : 0) * f.risk.downsideDeviation, 0);
  const wDD = fundAnalytics.reduce((s, f) => s + (currentValue > 0 ? f.currentValue / currentValue : 0) * f.risk.maxDrawdown, 0);

  const benchmarks = BENCHMARK_INDICES.map(b => {
    const expectedValue = funds.reduce((s, f) => s + computeBenchmarkValue(f.transactions || [], b.annualReturn, currentDate), 0);
    return {
      name: b.name,
      expectedValue,
      difference: currentValue - expectedValue,
      relativePerformance: expectedValue > 0 ? (currentValue - expectedValue) / expectedValue : 0,
    };
  });

  const totalProjectedContribution = fundAnalytics.reduce((s, f) => s + (f.projectedAnnualContribution || 0), 0);
  const aggregateGrowthRate = fundAnalytics.length ? fundAnalytics.reduce((s, f) => s + f.growthAssumption, 0) / fundAnalytics.length : roi;

  const forecast = {
    perFund: fundAnalytics.map(f => ({
      fundId: f.fundId,
      name: f.name,
      growthAssumption: f.growthAssumption,
      oneYear: f.forecast.oneYear,
      threeYear: f.forecast.threeYear,
      fiveYear: f.forecast.fiveYear,
    })),
    total: {
      oneYear: computeForecastValue({ currentValue, annualRate: aggregateGrowthRate, years: 1, projectedAnnualContribution: totalProjectedContribution }),
      threeYear: computeForecastValue({ currentValue, annualRate: aggregateGrowthRate, years: 3, projectedAnnualContribution: totalProjectedContribution }),
      fiveYear: computeForecastValue({ currentValue, annualRate: aggregateGrowthRate, years: 5, projectedAnnualContribution: totalProjectedContribution }),
    },
  };

  const tax = fundAnalytics.reduce((s, f) => ({
    longTermTax: s.longTermTax + f.tax.longTermTax,
    shortTermTax: s.shortTermTax + f.tax.shortTermTax,
    longTermGain: s.longTermGain + f.tax.longTermGain,
    shortTermGain: s.shortTermGain + f.tax.shortTermGain,
  }), { longTermTax: 0, shortTermTax: 0, longTermGain: 0, shortTermGain: 0 });

  const allTransactions = funds.flatMap(f => f.transactions || []);
  const portfolioIrr = computeIRR(allTransactions, currentValue, currentDate);

  const dividendSummary = fundAnalytics.reduce((s, f) => ({
    totalDividends: s.totalDividends + f.dividends.totalDividends,
    annualDividend: s.annualDividend + f.dividends.annualDividend,
    dividendYield: currentValue > 0 ? (s.annualDividend + f.dividends.annualDividend) / currentValue : 0,
  }), { totalDividends: 0, annualDividend: 0, dividendYield: 0 });

  return {
    funds: fundAnalytics,
    portfolio: { totalInvestment, currentValue, totalGain, roi, cagr, holdingYears, irr: portfolioIrr },
    diversification,
    benchmarks,
    risk: { volatility: wVol, downsideDeviation: wDown, maxDrawdown: wDD },
    forecast,
    tax,
    dividends: dividendSummary,
  };
};
