import { Component, input, computed } from '@angular/core';
import { PortfolioFund, FundAnalytics } from '../../types/fund.types';
import { formatNumber, formatPercent } from '../../utils/formatters';

@Component({
  selector: 'app-fund-hero',
  imports: [],
  templateUrl: './fund-hero.html',
  styleUrl: './fund-hero.css',
})
export class FundHero {
  fund = input.required<PortfolioFund>();
  analytics = input<FundAnalytics | null>(null);

  isPositive = computed(() => (this.fund()?.totalGain ?? 0) >= 0);
  riskLevel = computed(() => {
    const vol = this.analytics()?.risk?.volatility ?? 0;
    if (vol > 0.15) return 'High Risk';
    if (vol > 0.08) return 'Medium Risk';
    return 'Low Risk';
  });

  fmt = formatNumber;
  pct = formatPercent;
}
