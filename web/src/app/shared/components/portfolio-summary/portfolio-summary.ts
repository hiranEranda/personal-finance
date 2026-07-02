import { Component, inject, computed } from '@angular/core';
import { FundService } from '../../services/fund.service';
import { PortfolioService } from '../../../pages/shares/portfolio.service';
import { FixedDepositsService } from '../../services/fixed-deposits.service';
import { formatNumber } from '../../utils/formatters';

@Component({
  selector: 'app-portfolio-summary',
  imports: [],
  templateUrl: './portfolio-summary.html',
  styleUrl: './portfolio-summary.css',
})
export class PortfolioSummary {
  private fundService = inject(FundService);
  private portfolioService = inject(PortfolioService);
  private fixedDepositsService = inject(FixedDepositsService);

  fundsValue = computed(() => this.fundService.totals().currentValue);
  sharesValue = computed(() => this.portfolioService.totals().totalMarketValue);
  fdValue = computed(() => this.fixedDepositsService.totals().currentValue);

  totalInvested = computed(
    () =>
      this.fundService.totals().totalInvestment +
      this.portfolioService.totals().totalCost +
      this.fixedDepositsService.totals().totalPrincipal,
  );

  currentValue = computed(() => this.fundsValue() + this.sharesValue() + this.fdValue());
  totalGain = computed(() => this.currentValue() - this.totalInvested());
  isPositive = computed(() => this.totalGain() >= 0);

  fmt = (v: number, d = 0) => formatNumber(v, d);
}
