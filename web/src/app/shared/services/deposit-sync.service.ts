import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';

const API_URL = 'http://localhost:3001/api/deposits';

interface SyncResult {
  scanned: number;
  inserted: number;
  duplicates_skipped: number;
  pending_review: number;
  parse_errors: number;
}

export interface ReviewItem {
  id: string;
  source: string;
  pdf_filename: string;
  parsed_fund_name: string;
  issued_date: string | null;
  amount: number | null;
  nav: number | null;
  units: number | null;
}

@Injectable({ providedIn: 'root' })
export class DepositSyncService {
  private http = inject(HttpClient);

  private _syncing = signal(false);
  private _lastResult = signal<SyncResult | null>(null);
  private _error = signal<string | null>(null);
  private _reviewQueue = signal<ReviewItem[]>([]);
  private _mappingId = signal<string | null>(null);

  readonly syncing = this._syncing.asReadonly();
  readonly lastResult = this._lastResult.asReadonly();
  readonly error = this._error.asReadonly();
  readonly reviewQueue = this._reviewQueue.asReadonly();
  readonly mappingId = this._mappingId.asReadonly();

  constructor() {
    this.loadReviewQueue();
  }

  loadReviewQueue(): void {
    this.http.get<{ items: ReviewItem[] }>(`${API_URL}/review`).subscribe({
      next: (res) => this._reviewQueue.set(res.items),
      error: () => this._error.set('Could not load the review queue.'),
    });
  }

  syncNow(): void {
    this._syncing.set(true);
    this._error.set(null);
    this._lastResult.set(null);

    this.http.post<SyncResult>(`${API_URL}/sync`, {}).subscribe({
      next: (result) => {
        this._lastResult.set(result);
        this._syncing.set(false);
        this.loadReviewQueue();
      },
      error: () => {
        this._error.set('Sync failed. Is the deposit-parser service running?');
        this._syncing.set(false);
      },
    });
  }

  mapToFund(reviewId: string, fundId: string): void {
    this._mappingId.set(reviewId);
    this.http.post(`${API_URL}/review/${reviewId}/map`, { fund_id: fundId }).subscribe({
      next: () => {
        this._mappingId.set(null);
        this.loadReviewQueue();
      },
      error: () => {
        this._error.set('Failed to map this item.');
        this._mappingId.set(null);
      },
    });
  }
}
