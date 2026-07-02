import { Component, inject, signal, computed, effect, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { ChartModule } from 'primeng/chart';
import { FundService } from '../../shared/services/fund.service';
import { formatCompact } from '../../shared/utils/formatters';
import { FundsSubnav } from '../../shared/components/funds-subnav/funds-subnav';
import { PriceSync } from '../../shared/components/price-sync/price-sync';

interface MarketEntry {
  fund_name: string;
  company: string;
  buying_price: number;
  selling_price: number;
}

interface RawMarketData {
  [date: string]: MarketEntry[];
}

interface MarketFund {
  name: string;
  company: string;
  data: { date: string; price: number }[];
  firstPrice: number;
  lastPrice: number;
  changePercent: number;
}

const COLORS = ['#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6','#06B6D4','#F97316','#EC4899'];

@Component({
  selector: 'app-compare',
  imports: [FormsModule, ChartModule, FundsSubnav, PriceSync],
  templateUrl: './compare.html',
  styleUrl: './compare.css',
})
export class Compare implements OnInit {
  private http = inject(HttpClient);
  private fundService = inject(FundService);

  portfolioFunds = this.fundService.portfolioData;

  // Market data state
  marketData = signal<MarketFund[]>([]);
  isLoading = signal(true);
  loadError = signal<string | null>(null);

  // Selection state
  searchQuery = signal('');
  selectedMarketFundNames = signal<string[]>([]);
  selectedPortfolioFundId = signal<string | null>(null);
  normalizeMode = signal(true); // true = % from base, false = absolute NAV
  dateFrom = signal('');
  dateTo = signal('');

  // All available dates from the data
  allDates = signal<string[]>([]);

  ngOnInit(): void {
    this.http.get<RawMarketData>('/market-data.json').subscribe({
      next: (raw) => {
        const dates = Object.keys(raw).sort();
        this.allDates.set(dates);
        if (dates.length) {
          this.dateFrom.set(dates[0]);
          this.dateTo.set(dates[dates.length - 1]);
        }

        // Build per-fund time series
        const fundMap = new Map<string, { company: string; data: { date: string; price: number }[] }>();
        dates.forEach(date => {
          (raw[date] || []).forEach(entry => {
            if (!fundMap.has(entry.fund_name)) {
              fundMap.set(entry.fund_name, { company: entry.company, data: [] });
            }
            fundMap.get(entry.fund_name)!.data.push({ date, price: entry.selling_price });
          });
        });

        const funds: MarketFund[] = [];
        fundMap.forEach((val, name) => {
          const series = val.data.sort((a, b) => a.date.localeCompare(b.date));
          if (series.length < 2) return;
          const first = series[0].price;
          const last = series[series.length - 1].price;
          funds.push({
            name, company: val.company, data: series,
            firstPrice: first, lastPrice: last,
            changePercent: first > 0 ? ((last - first) / first) * 100 : 0,
          });
        });
        funds.sort((a, b) => a.name.localeCompare(b.name));
        this.marketData.set(funds);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.loadError.set('Failed to load market data: ' + err.message);
        this.isLoading.set(false);
      },
    });
  }

  filteredMarketFunds = computed(() => {
    const q = this.searchQuery().toLowerCase();
    return this.marketData().filter(f =>
      !q || f.name.toLowerCase().includes(q) || f.company.toLowerCase().includes(q)
    );
  });

  selectedMarketFunds = computed(() =>
    this.marketData().filter(f => this.selectedMarketFundNames().includes(f.name))
  );

  selectedPortfolioFund = computed(() => {
    const id = this.selectedPortfolioFundId();
    if (!id) return null;
    return this.portfolioFunds().find(f => f.id === id) ?? null;
  });

  private filteredSeries(data: { date: string; price: number }[]): { date: string; price: number }[] {
    const from = this.dateFrom();
    const to = this.dateTo();
    return data.filter(d => (!from || d.date >= from) && (!to || d.date <= to));
  }

  private portfolioNavSeries(): { date: string; price: number }[] {
    const fund = this.selectedPortfolioFund();
    if (!fund) return [];
    const navHistory = Array.isArray(fund.navHistory) ? fund.navHistory : [];
    const txNavs = (fund.transactions || []).map(t => ({ date: t.date.substring(0, 10), price: t.nav }));
    const histNavs = navHistory.map((e: any) => ({ date: String(e.date).substring(0, 10), price: e.nav as number }));
    const combined = [...histNavs, ...txNavs];
    if (fund.currentNav > 0) combined.push({ date: new Date().toISOString().substring(0, 10), price: fund.currentNav });
    return combined.sort((a, b) => a.date.localeCompare(b.date)).filter(d => d.price > 0);
  }

  // Dates you actually bought units — kept separate from the rest of the NAV
  // line so purchase markers stay visible now that nav_history is daily
  // (~170 points/fund since the price-scraper started backfilling) instead of
  // the ~22 sparse monthly points it used to be, where every point got the
  // same dot and purchases still stood out on their own.
  private portfolioTransactionDates(): Set<string> {
    const fund = this.selectedPortfolioFund();
    if (!fund) return new Set();
    return new Set((fund.transactions || []).map(t => t.date.substring(0, 10)));
  }

  chartData = computed(() => {
    const marketFunds = this.selectedMarketFunds();
    const portfolioFund = this.selectedPortfolioFund();
    const normalize = this.normalizeMode();
    if (!marketFunds.length && !portfolioFund) return { labels: [], datasets: [] };

    const datasets: any[] = [];
    let colorIdx = 0;

    // Market fund datasets
    marketFunds.forEach(mf => {
      const series = this.filteredSeries(mf.data);
      if (!series.length) return;
      const basePrice = series[0].price;
      const color = COLORS[colorIdx++ % COLORS.length];
      datasets.push({
        label: mf.name,
        data: series.map(d => normalize ? ((d.price - basePrice) / basePrice) * 100 : d.price),
        xLabels: series.map(d => d.date),
        borderColor: color,
        backgroundColor: color + '18',
        tension: 0.3,
        pointRadius: 0,
        borderWidth: 2,
        fill: false,
      });
    });

    // Portfolio fund dataset
    if (portfolioFund) {
      const series = this.filteredSeries(this.portfolioNavSeries());
      if (series.length) {
        const basePrice = series[0].price;
        const color = COLORS[colorIdx % COLORS.length];
        datasets.push({
          label: `★ ${portfolioFund.name}`,
          data: series.map(d => normalize ? ((d.price - basePrice) / basePrice) * 100 : d.price),
          xLabels: series.map(d => d.date),
          isPortfolio: true,
          borderColor: color,
          backgroundColor: color + '30',
          tension: 0.3,
          pointRadius: 0,
          borderWidth: 3,
          borderDash: [6, 3],
          fill: false,
        });
      }
    }

    // Merge all unique dates as labels
    const allLabels = [...new Set(datasets.flatMap(ds => ds.xLabels || []))].sort();
    const txDates = this.portfolioTransactionDates();
    const finalDatasets = datasets.map(ds => {
      const map = new Map((ds.xLabels || []).map((l: string, i: number) => [l, ds.data[i]]));
      const data = allLabels.map(l => map.has(l) ? map.get(l) : null);
      if (!ds.isPortfolio) return { ...ds, data };
      // Only render a point where you actually made a purchase — the rest of
      // the (now daily) NAV line stays a plain line so those markers pop.
      return {
        ...ds,
        data,
        pointRadius: allLabels.map(l => (map.has(l) && txDates.has(l)) ? 5 : 0),
        pointHoverRadius: allLabels.map(l => (map.has(l) && txDates.has(l)) ? 7 : 3),
        pointBackgroundColor: ds.borderColor,
        pointBorderColor: '#fff',
        pointBorderWidth: 1,
      };
    });

    return { labels: allLabels, datasets: finalDatasets };
  });

  chartOptions = computed(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { labels: { color: '#94a3b8', boxWidth: 16 }, position: 'top' },
      tooltip: {
        callbacks: {
          label: (ctx: any) =>
            ctx.raw == null ? '' : `${ctx.dataset.label}: ${this.normalizeMode() ? ctx.raw.toFixed(2) + '%' : ctx.raw.toFixed(4)}`,
        },
      },
    },
    scales: {
      x: {
        ticks: { color: '#94a3b8', maxRotation: 35, maxTicksLimit: 14 },
        grid: { color: 'rgba(148,163,184,0.08)' },
      },
      y: {
        ticks: {
          color: '#94a3b8',
          callback: (v: number) => this.normalizeMode() ? v.toFixed(1) + '%' : formatCompact(v),
        },
        grid: { color: 'rgba(148,163,184,0.08)' },
      },
    },
  }));

  summaryRows = computed(() => {
    const rows: { name: string; company: string; first: number; last: number; change: number; isPortfolio: boolean }[] = [];

    this.selectedMarketFunds().forEach(mf => {
      const series = this.filteredSeries(mf.data);
      if (!series.length) return;
      const first = series[0].price;
      const last = series[series.length - 1].price;
      rows.push({ name: mf.name, company: mf.company, first, last, change: first > 0 ? ((last - first) / first) * 100 : 0, isPortfolio: false });
    });

    const pf = this.selectedPortfolioFund();
    if (pf) {
      const series = this.filteredSeries(this.portfolioNavSeries());
      if (series.length) {
        const first = series[0].price;
        const last = series[series.length - 1].price;
        rows.push({ name: pf.name, company: 'My Portfolio', first, last, change: first > 0 ? ((last - first) / first) * 100 : 0, isPortfolio: true });
      }
    }

    return rows.sort((a, b) => b.change - a.change);
  });

  toggleMarketFund(name: string): void {
    this.selectedMarketFundNames.update(prev => {
      if (prev.includes(name)) return prev.filter(n => n !== name);
      if (prev.length >= 7) return prev; // cap at 7 market funds
      return [...prev, name];
    });
  }

  isSelected(name: string): boolean {
    return this.selectedMarketFundNames().includes(name);
  }

  clearAll(): void {
    this.selectedMarketFundNames.set([]);
    this.selectedPortfolioFundId.set(null);
  }

  formatCompact = formatCompact;
}
