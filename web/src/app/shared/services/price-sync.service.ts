import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';

const API_URL = 'http://localhost:3001/api/prices';

interface SyncResult {
  days_scraped: number;
  nav_rows_upserted: number;
  funds_updated: string[];
  unmatched_names: string[];
}

interface BackfillJob {
  status: 'running' | 'done' | 'error';
  days_done: number;
  days_total: number | null;
  result: SyncResult | null;
  error: string | null;
}

@Injectable({ providedIn: 'root' })
export class PriceSyncService {
  private http = inject(HttpClient);

  private _syncing = signal(false);
  private _lastResult = signal<SyncResult | null>(null);
  private _error = signal<string | null>(null);
  private _backfillJob = signal<BackfillJob | null>(null);

  readonly syncing = this._syncing.asReadonly();
  readonly lastResult = this._lastResult.asReadonly();
  readonly error = this._error.asReadonly();
  readonly backfillJob = this._backfillJob.asReadonly();

  syncNow(): void {
    this._syncing.set(true);
    this._error.set(null);
    this._lastResult.set(null);

    this.http.post<SyncResult>(`${API_URL}/incremental`, {}).subscribe({
      next: (result) => {
        this._lastResult.set(result);
        this._syncing.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this._error.set(
          err.status === 409
            ? 'Gap since the last sync is too large for a quick sync — use "Backfill History" instead.'
            : 'Sync failed. Is the price-scraper service running?',
        );
        this._syncing.set(false);
      },
    });
  }

  startBackfill(months: number): void {
    this._error.set(null);
    this._backfillJob.set({ status: 'running', days_done: 0, days_total: null, result: null, error: null });

    this.http.post<{ job_id: string }>(`${API_URL}/backfill`, { months }).subscribe({
      next: ({ job_id }) => this.pollBackfill(job_id),
      error: () => {
        this._error.set('Failed to start backfill. Is the price-scraper service running?');
        this._backfillJob.set(null);
      },
    });
  }

  private pollBackfill(jobId: string): void {
    this.http.get<BackfillJob>(`${API_URL}/backfill/${jobId}`).subscribe({
      next: (job) => {
        this._backfillJob.set(job);
        if (job.status === 'running') {
          setTimeout(() => this.pollBackfill(jobId), 2000);
        }
      },
      error: () => {
        this._error.set('Lost track of the backfill job.');
        this._backfillJob.set(null);
      },
    });
  }
}
