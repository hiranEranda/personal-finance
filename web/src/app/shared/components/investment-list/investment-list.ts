import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { FundService } from '../../services/fund.service';

@Component({
  selector: 'app-investment-list',
  imports: [],
  templateUrl: './investment-list.html',
  styleUrl: './investment-list.css',
})
export class InvestmentList {
  private router = inject(Router);
  fundService = inject(FundService);

  funds = this.fundService.portfolioData;

  gainColor(gain: number): string {
    return gain >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400';
  }

  fmt(value: number): string {
    return (Number.isFinite(value) ? value : 0).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  navigate(fundId: string): void {
    this.router.navigate(['/fund', fundId]);
  }
}
