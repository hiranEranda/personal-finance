import { Injectable, inject, signal, computed, effect } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Subject, EMPTY } from 'rxjs';
import { debounceTime, switchMap, tap, catchError } from 'rxjs/operators';
import {
  PortfolioDocument,
  PortfolioTicker,
  PortfolioTrade,
  PortfolioSell,
  WeeklyPriceRow,
  Holding,
  SectorSlice,
  WeeklySnapshot,
  ShareSyncSummary,
  PORTFOLIO_PALETTE,
} from './portfolio.types';

// Backed by the Node API (server/server.js) which persists to the financeos
// Postgres database — see database/004_share_market.sql and portfolio.service's
// share_* tables. Single-document API: GET loads the whole portfolio, POST
// (debounced) saves the whole thing back.
const API_URL = 'http://localhost:3001/api/portfolio';

// share-parser service (Sync/Add buttons) — proxied by server/server.js at
// /api/share-parser/* → FastAPI :8003/api/v1/shares/*.
const SHARE_PARSER_URL = 'http://localhost:3001/api/share-parser';

const EMPTY_DOC: PortfolioDocument = {
  settings: { sellSideFeeRate: 0.0112 },
  sectorList: [],
  tickers: [],
  trades: [],
  sells: [],
  weeklyPrices: [],
};

@Injectable({ providedIn: 'root' })
export class PortfolioService {
  private http = inject(HttpClient);
  private saveSubject = new Subject<PortfolioDocument>();

  private _doc = signal<PortfolioDocument>(EMPTY_DOC);
  private _loading = signal(true);
  private _isSaving = signal(false);
  private _error = signal<string | null>(null);

  readonly doc = this._doc.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly isSaving = this._isSaving.asReadonly();
  readonly error = this._error.asReadonly();

  readonly tickers = computed(() => this._doc().tickers);
  readonly trades = computed(() => this._doc().trades);
  readonly sells = computed(() => this._doc().sells);
  readonly weeklyPrices = computed(() =>
    [...this._doc().weeklyPrices].sort((a, b) => a.weekEnding.localeCompare(b.weekEnding))
  );
  readonly sectorList = computed(() => this._doc().sectorList);
  // Transaction fee rate (default 1.12%), applied to buys (total cost) and
  // sells (break-even). Stored under the legacy 'sellSideFeeRate' settings key.
  readonly feeRate = computed(() => this._doc().settings.sellSideFeeRate);

  // ---- canonical per-trade cost math (single source of truth) ----
  // Every "total cost" figure in the app must come from these, never from the
  // stored feesTotal field: totalCost = qty × buyPx × (1 + feeRate).
  tradeGross(t: PortfolioTrade): number {
    return t.qty * t.buyPrice;
  }

  tradeFees(t: PortfolioTrade): number {
    return this.tradeGross(t) * this.feeRate();
  }

  tradeTotalCost(t: PortfolioTrade): number {
    return this.tradeGross(t) * (1 + this.feeRate());
  }

  readonly holdings = computed((): Holding[] => {
    const { tickers, trades, sells, settings } = this._doc();
    const holdings = tickers.map((t, i) => {
      const myTrades = trades.filter(tr => tr.ticker === t.ticker);
      const mySells = sells.filter(s => s.ticker === t.ticker);
      const qtyBought = myTrades.reduce((a, b) => a + b.qty, 0);
      const qtySold = mySells.reduce((a, b) => a + b.qty, 0);
      const qtyHeld = qtyBought - qtySold;
      const grossInvested = myTrades.reduce((a, b) => a + this.tradeGross(b), 0);
      const feesPaid = myTrades.reduce((a, b) => a + this.tradeFees(b), 0);
      const totalCost = grossInvested + feesPaid;
      const avgCost = qtyBought > 0 ? totalCost / qtyBought : 0;
      const marketValue = qtyHeld * t.currentPrice;
      const costBasisHeld = avgCost * qtyHeld;
      const unrealizedPL = marketValue - costBasisHeld;
      const netProceeds = mySells.reduce((a, b) => a + (b.qty * b.sellPrice - b.commission), 0);
      const realizedPL = netProceeds - avgCost * qtySold;
      const feeRate = settings.sellSideFeeRate;
      const breakEvenPrice = 1 - feeRate !== 0 ? avgCost / (1 - feeRate) : 0;
      return {
        ...t,
        qtyBought, qtySold, qtyHeld, grossInvested, feesPaid, totalCost, avgCost,
        marketValue, costBasisHeld, unrealizedPL, realizedPL, breakEvenPrice,
        weight: 0,
        color: PORTFOLIO_PALETTE[i % PORTFOLIO_PALETTE.length],
      };
    });
    const totalMarketValue = holdings.reduce((a, b) => a + b.marketValue, 0);
    holdings.forEach(h => (h.weight = totalMarketValue ? h.marketValue / totalMarketValue : 0));
    return holdings;
  });

  // Realized P&L across every ticker that ever had a sell — independent of
  // whether that ticker is still in the register. holdings() (below) is
  // keyed off tickers(), so deleting a fully-sold ticker (the normal way to
  // clear it off the dashboard once qtyHeld hits 0) would otherwise wipe its
  // historical realized P&L from the totals along with it. Trade/sell
  // history is intentionally never cascade-deleted (see database/schema.sql,
  // share_trades/share_sells) specifically so this figure stays accurate.
  readonly realizedPLAllTime = computed(() => {
    const { trades, sells } = this._doc();
    const tickersWithSells = new Set(sells.map(s => s.ticker));
    let total = 0;
    tickersWithSells.forEach(ticker => {
      const myTrades = trades.filter(t => t.ticker === ticker);
      const mySells = sells.filter(s => s.ticker === ticker);
      const qtyBought = myTrades.reduce((a, b) => a + b.qty, 0);
      const totalCost = myTrades.reduce((a, b) => a + this.tradeTotalCost(b), 0);
      const avgCost = qtyBought > 0 ? totalCost / qtyBought : 0;
      const qtySold = mySells.reduce((a, b) => a + b.qty, 0);
      const netProceeds = mySells.reduce((a, b) => a + (b.qty * b.sellPrice - b.commission), 0);
      total += netProceeds - avgCost * qtySold;
    });
    return total;
  });

  readonly totals = computed(() => {
    const holdings = this.holdings();
    const totalMarketValue = holdings.reduce((a, b) => a + b.marketValue, 0);
    const totalCost = holdings.reduce((a, b) => a + b.totalCost, 0);
    const totalCostBasisHeld = holdings.reduce((a, b) => a + b.costBasisHeld, 0);
    const totalUnrealizedPL = holdings.reduce((a, b) => a + b.unrealizedPL, 0);
    const totalUnrealizedPct = totalCostBasisHeld !== 0 ? totalUnrealizedPL / totalCostBasisHeld : 0;
    const totalRealizedPL = this.realizedPLAllTime();
    return { totalMarketValue, totalCost, totalUnrealizedPL, totalUnrealizedPct, totalRealizedPL };
  });

  readonly sectors = computed((): SectorSlice[] => {
    const holdings = this.holdings();
    const totalMarketValue = holdings.reduce((a, b) => a + b.marketValue, 0);
    const sectorMap: Record<string, number> = {};
    holdings.forEach(h => (sectorMap[h.sector] = (sectorMap[h.sector] || 0) + h.marketValue));
    return Object.keys(sectorMap)
      .map(sector => ({ sector, value: sectorMap[sector], pct: totalMarketValue ? sectorMap[sector] / totalMarketValue : 0, color: '' }))
      .sort((a, b) => b.value - a.value)
      .map((s, i) => ({ ...s, color: PORTFOLIO_PALETTE[i % PORTFOLIO_PALETTE.length] }));
  });

  readonly weeklySnapshots = computed((): WeeklySnapshot[] => {
    const { trades, sells } = this._doc();
    return this.weeklyPrices().map(w => {
      let portfolioValue = 0;
      Object.keys(w.prices).forEach(ticker => {
        const price = w.prices[ticker];
        if (price == null) return;
        const bought = trades.filter(t => t.ticker === ticker && t.buyDate <= w.weekEnding).reduce((a, b) => a + b.qty, 0);
        const sold = sells.filter(s => s.ticker === ticker && s.sellDate <= w.weekEnding).reduce((a, b) => a + b.qty, 0);
        portfolioValue += (bought - sold) * price;
      });
      const investedToDate = trades
        .filter(t => t.buyDate <= w.weekEnding)
        .reduce((a, b) => a + this.tradeTotalCost(b), 0);
      return { weekEnding: w.weekEnding, portfolioValue, investedToDate };
    });
  });

  constructor() {
    this.saveSubject.pipe(
      debounceTime(1000),
      switchMap(doc => {
        this._isSaving.set(true);
        this._error.set(null);
        return this.http.post<{ message: string }>(API_URL, doc).pipe(
          tap(() => this._isSaving.set(false)),
          catchError(() => {
            this._error.set('Failed to save changes. Please check server connection.');
            this._isSaving.set(false);
            return EMPTY;
          })
        );
      })
    ).subscribe();

    effect(() => {
      const doc = this._doc();
      if (!this._loading()) {
        this.saveSubject.next(doc);
      }
    });

    this.load();
  }

  private load(): void {
    this.http.get<PortfolioDocument>(API_URL).subscribe({
      next: doc => {
        this._doc.set({ ...EMPTY_DOC, ...doc });
        this._error.set(null);
        this._loading.set(false);
      },
      error: () => {
        this._error.set('Could not load portfolio data. Please ensure the server is running.');
        this._loading.set(false);
      },
    });
  }

  private update(mutator: (doc: PortfolioDocument) => PortfolioDocument): void {
    this._doc.update(mutator);
  }

  // ---- share-parser: Sync / Add (contract-note PDF ingestion) ----
  // Re-fetches the whole document from Postgres after a sync/upload so the
  // in-memory doc picks up rows the parser inserted directly — otherwise the
  // next debounced autosave would overwrite them with the stale in-memory copy.
  reload(): void {
    this.load();
  }

  syncShares() {
    return this.http.post<ShareSyncSummary>(`${SHARE_PARSER_URL}/sync`, {});
  }

  uploadShares(files: FileList) {
    const form = new FormData();
    Array.from(files).forEach(f => form.append('files', f));
    return this.http.post<ShareSyncSummary>(`${SHARE_PARSER_URL}/upload`, form);
  }

  // ---- tickers ----
  addTicker(ticker: PortfolioTicker): void {
    this.update(d => (d.tickers.some(t => t.ticker === ticker.ticker) ? d : { ...d, tickers: [...d.tickers, ticker] }));
  }

  updateTicker(ticker: string, patch: Partial<PortfolioTicker>): void {
    this.update(d => ({ ...d, tickers: d.tickers.map(t => (t.ticker === ticker ? { ...t, ...patch } : t)) }));
  }

  deleteTicker(ticker: string): void {
    this.update(d => ({ ...d, tickers: d.tickers.filter(t => t.ticker !== ticker) }));
  }

  // ---- trades ----
  addTrade(trade: Omit<PortfolioTrade, 'id'>): void {
    this.update(d => ({
      ...d,
      trades: [...d.trades, { ...trade, id: d.trades.reduce((m, t) => Math.max(m, t.id), 0) + 1 }],
    }));
  }

  deleteTrade(id: number): void {
    this.update(d => ({ ...d, trades: d.trades.filter(t => t.id !== id) }));
  }

  // ---- sells ----
  addSell(sell: Omit<PortfolioSell, 'id'>): void {
    this.update(d => ({
      ...d,
      sells: [...d.sells, { ...sell, id: d.sells.reduce((m, s) => Math.max(m, s.id), 0) + 1 }],
    }));
  }

  deleteSell(id: number): void {
    this.update(d => ({ ...d, sells: d.sells.filter(s => s.id !== id) }));
  }

  // ---- weekly prices ----
  addWeek(weekEnding: string): void {
    this.update(d => {
      if (d.weeklyPrices.some(w => w.weekEnding === weekEnding)) return d;
      const prices: WeeklyPriceRow['prices'] = {};
      d.tickers.forEach(t => (prices[t.ticker] = null));
      return { ...d, weeklyPrices: [...d.weeklyPrices, { weekEnding, prices }] };
    });
  }

  setWeeklyPrice(weekEnding: string, ticker: string, value: number | null): void {
    this.update(d => ({
      ...d,
      weeklyPrices: d.weeklyPrices.map(w =>
        w.weekEnding === weekEnding ? { ...w, prices: { ...w.prices, [ticker]: value } } : w
      ),
    }));
  }

  // ---- settings ----
  setFeeRate(rate: number): void {
    this.update(d => ({ ...d, settings: { ...d.settings, sellSideFeeRate: rate } }));
  }

  addSector(name: string): void {
    this.update(d => (d.sectorList.includes(name) ? d : { ...d, sectorList: [...d.sectorList, name] }));
  }

  removeSector(name: string): void {
    this.update(d => ({ ...d, sectorList: d.sectorList.filter(s => s !== name) }));
  }
}
