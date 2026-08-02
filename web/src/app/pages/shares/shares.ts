import { Component, inject, signal, computed, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ChartModule } from 'primeng/chart';
import { PortfolioService } from './portfolio.service';
import { Holding, PortfolioTrade, PortfolioSell, ShareSyncSummary } from './portfolio.types';
import { ThemeService } from '../../shared/services/theme';
import { formatNumber, formatCompact } from '../../shared/utils/formatters';

type SharesTab = 'dashboard' | 'register' | 'trades' | 'sells' | 'weekly' | 'charts' | 'settings';

@Component({
  selector: 'app-shares',
  imports: [FormsModule, ChartModule],
  templateUrl: './shares.html',
  styleUrl: './shares.css',
})
export class Shares {
  svc = inject(PortfolioService);
  private theme = inject(ThemeService);

  readonly tabs: { id: SharesTab; label: string }[] = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'register', label: 'Ticker Register' },
    { id: 'trades', label: 'Trade Log' },
    { id: 'sells', label: 'Sell Log' },
    { id: 'weekly', label: 'Weekly Prices' },
    { id: 'charts', label: 'Charts' },
    { id: 'settings', label: 'Settings' },
  ];

  activeTab = signal<SharesTab>('dashboard');

  // ---- sync / add (contract-note PDF ingestion) ----
  ingesting = signal(false);
  ingestMessage = signal<string | null>(null);
  ingestError = signal<string | null>(null);

  // ---- inline price editing (dashboard) ----
  editingTicker = signal<string | null>(null);
  editPriceValue = '';

  // ---- form models ----
  newTicker = { ticker: '', companyName: '', sector: '', currentPrice: '' };
  newTrade = { ticker: '', buyDate: '', qty: '', buyPrice: '', notes: '' };
  newSell = { ticker: '', sellDate: '', qty: '', sellPrice: '', commission: '', notes: '' };
  newWeekDate = '';
  feeRateInput = '';
  newSectorName = '';

  private formsInitialized = false;

  constructor() {
    // Pre-fill form defaults once data arrives; feeRateInput mirrors settings.
    effect(() => {
      if (this.svc.loading() || this.formsInitialized) return;
      this.formsInitialized = true;
      this.initFormDefaults();
    });
  }

  private initFormDefaults(): void {
    this.newTicker.sector = this.svc.sectorList()[0] ?? '';
    const first = this.svc.tickers()[0]?.ticker ?? '';
    this.newTrade.ticker = first;
    this.newSell.ticker = first;
    this.feeRateInput = (this.svc.feeRate() * 100).toFixed(2);
  }

  // ---- derived chart data (Chart.js via PrimeNG p-chart, matching the main dashboard) ----
  readonly sectorBars = computed(() =>
    this.svc.sectors().map(s => ({ ...s, barWidth: (s.pct * 100).toFixed(1) + '%' }))
  );

  readonly sortedTrades = computed(() =>
    [...this.svc.trades()].sort((a, b) => b.buyDate.localeCompare(a.buyDate))
  );

  readonly sortedSells = computed(() =>
    [...this.svc.sells()].sort((a, b) => b.sellDate.localeCompare(a.sellDate))
  );

  // ---- doughnut: weight by ticker / allocation by sector ----
  readonly weightChartData = computed(() => {
    this.theme.darkMode();
    const holdings = this.svc.holdings();
    return {
      labels: holdings.map(h => h.ticker),
      datasets: [{
        data: holdings.map(h => h.marketValue),
        backgroundColor: holdings.map(h => h.color),
        borderWidth: 2,
        borderColor: this.cssVar('--app-card'),
      }],
    };
  });

  readonly sectorChartData = computed(() => {
    this.theme.darkMode();
    const sectors = this.svc.sectors();
    return {
      labels: sectors.map(s => s.sector),
      datasets: [{
        data: sectors.map(s => s.value),
        backgroundColor: sectors.map(s => s.color),
        borderWidth: 2,
        borderColor: this.cssVar('--app-card'),
      }],
    };
  });

  readonly doughnutOptions = computed(() => {
    this.theme.darkMode();
    return {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx: any) => ` ${ctx.label}: ${this.money(ctx.raw)}` } },
      },
    };
  });

  // ---- line: portfolio value vs invested ----
  readonly valueLineData = computed(() => {
    this.theme.darkMode();
    const weekly = this.svc.weeklySnapshots();
    return {
      labels: weekly.map(w => this.fmtDate(w.weekEnding)),
      datasets: [
        {
          label: 'Invested to Date',
          data: weekly.map(w => w.investedToDate),
          borderColor: this.cssVar('--app-text-muted'),
          backgroundColor: 'transparent',
          borderDash: [6, 4],
          tension: 0.4,
          pointRadius: 2,
          borderWidth: 2,
        },
        {
          label: 'Portfolio Value',
          data: weekly.map(w => w.portfolioValue),
          borderColor: this.cssVar('--app-accent'),
          backgroundColor: this.cssVar('--app-accent-soft'),
          fill: true,
          tension: 0.4,
          pointRadius: 2,
          borderWidth: 2.5,
        },
      ],
    };
  });

  // ---- line: individual share price trends ----
  readonly priceTrendData = computed(() => {
    this.theme.darkMode();
    const weekly = this.svc.weeklyPrices();
    const holdings = this.svc.holdings();
    return {
      labels: weekly.map(w => this.fmtDate(w.weekEnding)),
      datasets: holdings.map(h => ({
        label: h.ticker,
        data: weekly.map(w => w.prices[h.ticker] ?? null),
        borderColor: h.color,
        backgroundColor: h.color,
        spanGaps: true,
        tension: 0.4,
        pointRadius: 2,
        borderWidth: 2,
      })),
    };
  });

  readonly lineChartOptions = computed(() => {
    this.theme.darkMode();
    const textMuted = this.cssVar('--app-text-muted');
    const border = this.cssVar('--app-border');
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: textMuted, boxWidth: 12 } },
        tooltip: { callbacks: { label: (ctx: any) => `${ctx.dataset.label}: ${this.money(ctx.raw)}` } },
      },
      scales: {
        x: { ticks: { color: textMuted, maxTicksLimit: 8 }, grid: { color: border } },
        y: { ticks: { color: textMuted, callback: (v: number) => formatCompact(v) }, grid: { color: border } },
      },
    };
  });

  // ---- bar: unrealized P&L by ticker ----
  readonly plBarData = computed(() => {
    this.theme.darkMode();
    const holdings = this.svc.holdings();
    const positive = this.cssVar('--color-positive');
    const negative = this.cssVar('--color-negative');
    return {
      labels: holdings.map(h => h.ticker),
      datasets: [{
        label: 'Unrealized P&L',
        data: holdings.map(h => h.unrealizedPL),
        backgroundColor: holdings.map(h => (h.unrealizedPL >= 0 ? positive : negative)),
        borderRadius: 4,
        maxBarThickness: 48,
      }],
    };
  });

  readonly plBarOptions = computed(() => {
    this.theme.darkMode();
    const textMuted = this.cssVar('--app-text-muted');
    const border = this.cssVar('--app-border');
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx: any) => this.pl(ctx.raw) } },
      },
      scales: {
        x: { ticks: { color: textMuted }, grid: { display: false } },
        y: { ticks: { color: textMuted, callback: (v: number) => formatCompact(v) }, grid: { color: border } },
      },
    };
  });

  // ---- bar: cost basis vs market value by ticker ----
  readonly cbmvBarData = computed(() => {
    this.theme.darkMode();
    const holdings = this.svc.holdings();
    return {
      labels: holdings.map(h => h.ticker),
      datasets: [
        {
          label: 'Cost Basis',
          data: holdings.map(h => h.costBasisHeld),
          backgroundColor: this.cssVar('--app-ink'),
          borderRadius: 4,
          maxBarThickness: 28,
        },
        {
          label: 'Market Value',
          data: holdings.map(h => h.marketValue),
          backgroundColor: this.cssVar('--app-accent'),
          borderRadius: 4,
          maxBarThickness: 28,
        },
      ],
    };
  });

  readonly cbmvBarOptions = computed(() => {
    this.theme.darkMode();
    const textMuted = this.cssVar('--app-text-muted');
    const border = this.cssVar('--app-border');
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: textMuted, boxWidth: 12 } },
        tooltip: { callbacks: { label: (ctx: any) => `${ctx.dataset.label}: ${this.money(ctx.raw)}` } },
      },
      scales: {
        x: { ticks: { color: textMuted }, grid: { display: false } },
        y: { ticks: { color: textMuted, callback: (v: number) => formatCompact(v) }, grid: { color: border } },
      },
    };
  });

  private cssVar(name: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  // ---- formatting ----
  money(v: number): string {
    return 'Rs. ' + formatNumber(Math.abs(v));
  }

  pl(v: number): string {
    return (v >= 0 ? '+ ' : '- ') + this.money(v);
  }

  qty(v: number): string {
    return Math.round(v).toLocaleString('en-US');
  }

  pct(v: number, digits = 1): string {
    return (v * 100).toFixed(digits) + '%';
  }

  signedPct(v: number): string {
    return (v >= 0 ? '+' : '-') + Math.abs(v * 100).toFixed(2) + '%';
  }

  fmtDate(d: string): string {
    return d ? String(d).slice(2) : '';
  }

  num(v: number): string {
    return formatNumber(v);
  }

  plClass(v: number): string {
    if (v > 0.0001) return 'token-positive';
    if (v < -0.0001) return 'token-negative';
    return 'token-text-muted';
  }

  gross(t: PortfolioTrade): number {
    return this.svc.tradeGross(t);
  }

  fees(t: PortfolioTrade): number {
    return this.svc.tradeFees(t);
  }

  totalCost(t: PortfolioTrade): number {
    return this.svc.tradeTotalCost(t);
  }

  netProceeds(s: PortfolioSell): number {
    return s.qty * s.sellPrice - s.commission;
  }

  weeklyCell(prices: Record<string, number | null>, ticker: string): string {
    const v = prices[ticker];
    return v == null ? '' : String(v);
  }

  // ---- dashboard inline price edit ----
  startEdit(h: Holding): void {
    this.editingTicker.set(h.ticker);
    this.editPriceValue = String(h.currentPrice);
  }

  saveEdit(ticker: string): void {
    const val = parseFloat(this.editPriceValue);
    if (!isNaN(val) && val > 0) {
      this.svc.updateTicker(ticker, { currentPrice: val });
    }
    this.editingTicker.set(null);
  }

  onEditKeydown(event: KeyboardEvent, ticker: string): void {
    if (event.key === 'Enter') this.saveEdit(ticker);
    if (event.key === 'Escape') this.editingTicker.set(null);
  }

  // ---- register ----
  addTickerDisabled(): boolean {
    return !(this.newTicker.ticker && this.newTicker.companyName && this.newTicker.currentPrice);
  }

  addTicker(): void {
    const price = parseFloat(this.newTicker.currentPrice);
    if (this.addTickerDisabled() || isNaN(price)) return;
    this.svc.addTicker({
      ticker: this.newTicker.ticker.toUpperCase(),
      companyName: this.newTicker.companyName,
      exchange: 'CSE',
      sector: this.newTicker.sector || this.svc.sectorList()[0] || '',
      currency: 'LKR',
      currentPrice: price,
      notes: '',
    });
    this.newTicker = { ticker: '', companyName: '', sector: this.svc.sectorList()[0] ?? '', currentPrice: '' };
  }

  onRegisterPriceChange(ticker: string, raw: string, fallback: number): void {
    const v = parseFloat(raw);
    this.svc.updateTicker(ticker, { currentPrice: isNaN(v) ? fallback : v });
  }

  // ---- trades ----
  addTradeDisabled(): boolean {
    return !(this.newTrade.ticker && this.newTrade.buyDate && this.newTrade.qty && this.newTrade.buyPrice);
  }

  addTrade(): void {
    const qty = parseFloat(this.newTrade.qty);
    const buyPrice = parseFloat(this.newTrade.buyPrice);
    if (this.addTradeDisabled() || isNaN(qty) || qty <= 0 || isNaN(buyPrice) || buyPrice <= 0) return;
    this.svc.addTrade({
      ticker: this.newTrade.ticker,
      buyDate: this.newTrade.buyDate,
      qty, buyPrice,
      feesTotal: qty * buyPrice * this.svc.feeRate(),
      notes: this.newTrade.notes,
    });
    this.newTrade = { ticker: this.newTrade.ticker, buyDate: '', qty: '', buyPrice: '', notes: '' };
  }

  // ---- sells ----
  addSellDisabled(): boolean {
    return !(this.newSell.ticker && this.newSell.sellDate && this.newSell.qty && this.newSell.sellPrice);
  }

  addSell(): void {
    const qty = parseFloat(this.newSell.qty);
    const sellPrice = parseFloat(this.newSell.sellPrice);
    const commission = parseFloat(this.newSell.commission) || 0;
    if (this.addSellDisabled() || isNaN(qty) || qty <= 0 || isNaN(sellPrice) || sellPrice <= 0) return;
    this.svc.addSell({
      ticker: this.newSell.ticker,
      sellDate: this.newSell.sellDate,
      qty, sellPrice, commission,
      notes: this.newSell.notes,
    });
    this.newSell = { ticker: this.newSell.ticker, sellDate: '', qty: '', sellPrice: '', commission: '', notes: '' };
  }

  // ---- weekly ----
  addWeek(): void {
    if (!this.newWeekDate) return;
    this.svc.addWeek(this.newWeekDate);
    this.newWeekDate = '';
  }

  onWeeklyPriceChange(weekEnding: string, ticker: string, raw: string): void {
    const v = raw === '' ? null : parseFloat(raw);
    this.svc.setWeeklyPrice(weekEnding, ticker, v == null || isNaN(v) ? null : v);
  }

  // ---- settings ----
  onFeeRateChange(): void {
    const num = parseFloat(this.feeRateInput);
    if (!isNaN(num) && num >= 0) {
      this.svc.setFeeRate(num / 100);
    }
  }

  addSector(): void {
    const name = this.newSectorName.trim();
    if (!name) return;
    this.svc.addSector(name);
    this.newSectorName = '';
  }

  // ---- sync / add (contract-note PDF ingestion) ----
  syncNow(): void {
    if (this.ingesting()) return;
    this.ingesting.set(true);
    this.ingestMessage.set(null);
    this.ingestError.set(null);
    this.svc.syncShares().subscribe({
      next: summary => this.onIngestDone(summary),
      error: () => this.onIngestFailed('Sync failed. Is the share-parser service running?'),
    });
  }

  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input.files;
    if (!files || files.length === 0) return;
    this.ingesting.set(true);
    this.ingestMessage.set(null);
    this.ingestError.set(null);
    this.svc.uploadShares(files).subscribe({
      next: summary => this.onIngestDone(summary),
      error: () => this.onIngestFailed('Upload failed. Is the share-parser service running?'),
    });
    input.value = '';
  }

  private onIngestDone(summary: ShareSyncSummary): void {
    this.ingesting.set(false);
    const parts: string[] = [];
    if (summary.trades_inserted) parts.push(`${summary.trades_inserted} buy${summary.trades_inserted === 1 ? '' : 's'}`);
    if (summary.sells_inserted) parts.push(`${summary.sells_inserted} sell${summary.sells_inserted === 1 ? '' : 's'}`);
    if (summary.tickers_created) parts.push(`${summary.tickers_created} new ticker${summary.tickers_created === 1 ? '' : 's'}`);
    if (summary.skipped_duplicates) parts.push(`${summary.skipped_duplicates} already synced`);
    if (summary.parse_errors) parts.push(`${summary.parse_errors} couldn't be read`);
    this.ingestMessage.set(
      summary.scanned === 0 ? 'No new contract notes found.' : (parts.join(', ') || 'Processed, nothing new.')
    );
    this.svc.reload();
  }

  private onIngestFailed(message: string): void {
    this.ingesting.set(false);
    this.ingestError.set(message);
  }
}
