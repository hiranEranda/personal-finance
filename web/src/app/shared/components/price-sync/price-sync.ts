import { Component, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PriceSyncService } from '../../services/price-sync.service';

@Component({
  selector: 'app-price-sync',
  imports: [FormsModule],
  templateUrl: './price-sync.html',
  styleUrl: './price-sync.css',
})
export class PriceSync {
  priceSyncService = inject(PriceSyncService);
  backfillMonths = signal<number | null>(null);

  isBusy = computed(
    () => this.priceSyncService.syncing() || this.priceSyncService.backfillJob()?.status === 'running',
  );

  statusText = computed(() => {
    const job = this.priceSyncService.backfillJob();
    if (job?.status === 'running') return `${job.days_done}${job.days_total ? '/' + job.days_total : ''}d…`;
    if (job?.status === 'done' && job.result) return `+${job.result.nav_rows_upserted} rows`;
    if (job?.status === 'error') return 'Backfill failed';

    const result = this.priceSyncService.lastResult();
    if (result) return `+${result.nav_rows_upserted} rows`;
    if (this.priceSyncService.error()) return this.priceSyncService.error();
    return null;
  });

  // A months value triggers the (async) backfill; empty defaults to the fast incremental sync.
  sync(): void {
    const months = this.backfillMonths();
    if (months && months > 0) {
      this.priceSyncService.startBackfill(months);
    } else {
      this.priceSyncService.syncNow();
    }
  }
}
