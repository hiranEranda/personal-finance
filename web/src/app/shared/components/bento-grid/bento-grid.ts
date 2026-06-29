import { Component, inject, computed } from '@angular/core';
import { FundService } from '../../services/fund.service';
import { formatNumber, formatPercent } from '../../utils/formatters';

@Component({
  selector: 'app-bento-grid',
  imports: [],
  templateUrl: './bento-grid.html',
  styleUrl: './bento-grid.css',
})
export class BentoGrid {
  private fundService = inject(FundService);

  totals = this.fundService.totals;
  analytics = this.fundService.analytics;

  roi = computed(() => {
    const t = this.totals();
    return t.totalInvestment > 0 ? t.totalGain / t.totalInvestment : 0;
  });
  cagr = computed(() => this.analytics()?.portfolio?.cagr ?? 0);
  irr = computed(() => this.analytics()?.portfolio?.irr ?? 0);
  volatility = computed(() => this.analytics()?.risk?.volatility ?? 0);
  isPositive = computed(() => (this.totals()?.totalGain ?? 0) >= 0);

  fmt = (v: number, d = 0) => formatNumber(v, d);
  pct = (v: number) => formatPercent(v);
}
