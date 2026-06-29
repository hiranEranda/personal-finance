import { Component, inject, computed } from '@angular/core';
import { ChartModule } from 'primeng/chart';
import { FundService } from '../../services/fund.service';
import { formatCompact } from '../../utils/formatters';

const COLORS = ['#3B82F6', '#10B981', '#8B5CF6', '#F59E0B', '#EF4444', '#EC4899'];

@Component({
  selector: 'app-allocation-chart',
  imports: [ChartModule],
  templateUrl: './allocation-chart.html',
  styleUrl: './allocation-chart.css',
})
export class AllocationChart {
  private fundService = inject(FundService);

  private allocationData = computed(() => {
    const funds = this.fundService.portfolioData();
    const groups: Record<string, number> = {};
    funds.forEach(f => {
      const type = f.type || 'Other';
      groups[type] = (groups[type] || 0) + f.currentValue;
    });
    return Object.entries(groups)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  });

  totalValue = computed(() => this.fundService.totals().currentValue);

  chartData = computed(() => ({
    labels: this.allocationData().map(d => d.name),
    datasets: [{
      data: this.allocationData().map(d => d.value),
      backgroundColor: COLORS,
      borderWidth: 2,
      borderColor: 'transparent',
    }],
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
