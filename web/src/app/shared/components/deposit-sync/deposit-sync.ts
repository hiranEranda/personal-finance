import { Component, ElementRef, HostListener, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DepositSyncService } from '../../services/deposit-sync.service';
import { FundService } from '../../services/fund.service';

@Component({
  selector: 'app-deposit-sync',
  imports: [FormsModule],
  templateUrl: './deposit-sync.html',
  styleUrl: './deposit-sync.css',
})
export class DepositSync {
  depositSyncService = inject(DepositSyncService);
  fundService = inject(FundService);
  private elementRef = inject(ElementRef);

  selectedFund: Record<string, string> = {};
  showReview = signal(false);

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (this.showReview() && !this.elementRef.nativeElement.contains(event.target)) {
      this.showReview.set(false);
    }
  }

  syncNow(): void {
    this.depositSyncService.syncNow();
  }

  toggleReview(): void {
    this.showReview.update((v) => !v);
  }

  map(reviewId: string): void {
    const fundId = this.selectedFund[reviewId];
    if (!fundId) return;
    this.depositSyncService.mapToFund(reviewId, fundId);
  }
}
