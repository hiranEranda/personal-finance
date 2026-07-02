import { Component, inject, computed } from '@angular/core';
import { ChartModule } from 'primeng/chart';
import { FundService } from '../../services/fund.service';
import { PortfolioService } from '../../../pages/shares/portfolio.service';
import { PORTFOLIO_PALETTE } from '../../../pages/shares/portfolio.types';
import { FixedDepositsService } from '../../services/fixed-deposits.service';
import { formatCompact } from '../../utils/formatters';

// Reuses the shares page's palette for visual consistency across the app.
const COLORS = PORTFOLIO_PALETTE;

@Component({
  selector: 'app-asset-allocation-chart',
  imports: [ChartModule],
  templateUrl: './asset-allocation-chart.html',
  styleUrl: './asset-allocation-chart.css',
})
export class AssetAllocationChart {
  private fundService = inject(FundService);
  private portfolioService = inject(PortfolioService);
  private fixedDepositsService = inject(FixedDepositsService);

  private allocationData = computed(() => {
    const funds = this.fundService.totals().currentValue;
    const shares = this.portfolioService.totals().totalMarketValue;
    const fds = this.fixedDepositsService.totals().currentValue;
    return [
      { name: 'Funds', value: funds },
      { name: 'Shares', value: shares },
      { name: 'Fixed Deposits', value: fds },
    ].filter((d) => d.value > 0);
  });

  totalValue = computed(() => this.allocationData().reduce((acc, d) => acc + d.value, 0));

  chartData = computed(() => ({
    labels: this.allocationData().map((d) => d.name),
    datasets: [
      {
        data: this.allocationData().map((d) => d.value),
        backgroundColor: COLORS,
        borderWidth: 2,
        borderColor: 'transparent',
      },
    ],
  }));

  chartOptions = computed(() => ({
    responsive: true,
    maintainAspectRatio: false,
    cutout: '55%',
    plugins: {
      legend: {
        position: 'right',
        labels: { color: '#94a3b8', padding: 12, boxWidth: 12 },
      },
      tooltip: {
        callbacks: {
          label: (ctx: any) => ` ${ctx.label}: ${formatCompact(ctx.raw)}`,
        },
      },
    },
  }));

  fmt = formatCompact;
}
