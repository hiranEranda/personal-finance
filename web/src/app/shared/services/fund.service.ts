import { Injectable, inject, signal, computed, effect } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Subject, EMPTY, combineLatest, of } from 'rxjs';
import { debounceTime, switchMap, tap, catchError } from 'rxjs/operators';
import { Fund, PortfolioFund, PortfolioAnalytics, Totals } from '../types/fund.types';
import { calculatePortfolioAnalytics } from '../utils/analytics';

const API_URL = 'http://localhost:3001/api/funds';
const NAV_HISTORY_URL = 'http://localhost:3001/api/nav-history';

interface NavHistoryEntry { monthly_performance: { date: string; nav: number }[]; fund_info: Record<string, unknown>; yearly_performance: Record<string, unknown> }
type NavHistoryData = Record<string, NavHistoryEntry>;

@Injectable({ providedIn: 'root' })
export class FundService {
  private http = inject(HttpClient);
  private saveSubject = new Subject<Fund[]>();

  private _funds = signal<Fund[]>([]);
  private _loading = signal(true);
  private _isSaving = signal(false);
  private _error = signal<string | null>(null);

  readonly funds = this._funds.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly isSaving = this._isSaving.asReadonly();
  readonly error = this._error.asReadonly();

  readonly portfolioData = computed((): PortfolioFund[] =>
    this._funds().map(fund => {
      const totalInvestment = fund.transactions.reduce((acc, t) => acc + t.amount, 0);
      const totalUnits = fund.transactions.reduce((acc, t) => acc + t.units, 0);
      const currentValue = totalUnits * fund.currentNav;
      const totalGain = currentValue - totalInvestment;
      const gainPercentage = totalInvestment > 0 ? (totalGain / totalInvestment) * 100 : 0;
      return { ...fund, totalInvestment, totalUnits, currentValue, totalGain, gainPercentage };
    })
  );

  readonly analytics = computed((): PortfolioAnalytics => calculatePortfolioAnalytics(this.portfolioData()));

  readonly totals = computed((): Totals => {
    const data = this.portfolioData();
    const totalInvestment = data.reduce((acc, f) => acc + f.totalInvestment, 0);
    const currentValue = data.reduce((acc, f) => acc + f.currentValue, 0);
    return { totalInvestment, currentValue, totalGain: currentValue - totalInvestment };
  });

  constructor() {
    this.saveSubject.pipe(
      debounceTime(1000),
      switchMap(funds => {
        this._isSaving.set(true);
        this._error.set(null);
        return this.http.post<{ message: string }>(API_URL, funds).pipe(
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
      const funds = this._funds();
      if (!this._loading()) {
        this.saveSubject.next(funds);
      }
    });

    this.loadFunds();
  }

  private loadFunds(): void {
    combineLatest([
      this.http.get<Fund[]>(API_URL),
      this.http.get<NavHistoryData>(NAV_HISTORY_URL).pipe(catchError(() => of({} as NavHistoryData))),
    ]).subscribe({
      next: ([fundsData, navHistoryData]) => {
        const enrichedFunds = fundsData.map(fund => {
          const history = navHistoryData[fund.id];
          if (history) {
            return {
              ...fund,
              navHistory: history.monthly_performance || [],
              fundInfo: history.fund_info || {},
              yearlyPerformance: history.yearly_performance || {},
            };
          }
          return fund;
        });
        this._funds.set(enrichedFunds);
        this._error.set(null);
        this._loading.set(false);
      },
      error: () => {
        this._error.set('Could not load data from the server. Please ensure the server is running.');
        this._funds.set([]);
        this._loading.set(false);
      },
    });
  }

  addFund(newFund: Partial<Fund>): void {
    const fundWithId: Fund = {
      ...(newFund as Fund),
      id: Date.now().toString(),
      transactions: newFund.transactions || [],
      currentNav: newFund.currentNav || 0,
    };
    this._funds.update(funds => [...funds, fundWithId]);
  }

  editFund(updatedFund: Fund): void {
    this._funds.update(funds => funds.map(f => f.id === updatedFund.id ? updatedFund : f));
  }

  deleteFund(fundId: string): void {
    this._funds.update(funds => funds.filter(f => f.id !== fundId));
  }

  updateFundTransactions(fundId: string, updatedData: Partial<Fund>): void {
    this._funds.update(funds => funds.map(f => f.id === fundId ? { ...f, ...updatedData } : f));
  }
}
