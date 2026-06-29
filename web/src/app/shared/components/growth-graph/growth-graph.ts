import { Component, inject, signal, computed } from '@angular/core';
import { ChartModule } from 'primeng/chart';
import { FundService } from '../../services/fund.service';
import { formatCompact } from '../../utils/formatters';

const TIME_RANGES: Record<string, number> = {
  'All Time': Infinity,
  '5 Years': 5 * 365,
  '1 Year': 365,
  '6 Months': 180,
  '3 Months': 90,
  '1 Month': 30,
};

@Component({
  selector: 'app-growth-graph',
  imports: [ChartModule],
  templateUrl: './growth-graph.html',
  styleUrl: './growth-graph.css',
})
export class GrowthGraph {
  private fundService = inject(FundService);

  timeRanges = Object.keys(TIME_RANGES);
  selectedRange = signal('All Time');

  private graphPoints = computed(() => {
    const funds = this.fundService.portfolioData();
    if (!funds.length) return [];

    const now = new Date();
    const filterDays = TIME_RANGES[this.selectedRange()];
    const oldestAllowed = filterDays === Infinity ? null : new Date(now.getTime() - filterDays * 86400000);

    const allDates = new Set<string>();
    funds.forEach(f => {
      (f.transactions || []).forEach(t => {
        const d = new Date(t.date);
        if (isNaN(d.getTime())) return;
        if (oldestAllowed && d < oldestAllowed) return;
        allDates.add(d.toISOString().split('T')[0]);
      });
    });
    allDates.add(now.toISOString().split('T')[0]);

    return Array.from(allDates).sort().map(dateStr => {
      const date = new Date(dateStr);
      let totalInvested = 0;
      let totalValue = 0;

      funds.forEach(fund => {
        let fundUnits = 0;
        let fundInvested = 0;
        let lastNav = 10;

        (fund.transactions || []).filter(t => new Date(t.date) <= date).forEach(t => {
          fundUnits += t.units;
          fundInvested += t.amount;
          lastNav = t.nav;
        });

        const currentNav = dateStr === now.toISOString().split('T')[0] && fund.currentNav ? fund.currentNav : lastNav;
        totalInvested += fundInvested;
        totalValue += fundUnits * currentNav;
      });

      return { date: dateStr, invested: totalInvested, value: totalValue };
    });
  });

  chartData = computed(() => {
    const points = this.graphPoints();
    return {
      labels: points.map(p => new Date(p.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })),
      datasets: [
        {
          label: 'Invested Amount',
          data: points.map(p => p.invested),
          fill: true,
          borderColor: '#10B981',
          backgroundColor: 'rgba(16,185,129,0.2)',
          tension: 0.4,
          pointRadius: 2,
          borderWidth: 2,
        },
        {
          label: 'Current Value',
          data: points.map(p => p.value),
          fill: true,
          borderColor: '#8B5CF6',
          backgroundColor: 'rgba(139,92,246,0.2)',
          tension: 0.4,
          pointRadius: 2,
          borderWidth: 2,
        },
      ],
    };
  });

  chartOptions = computed(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { labels: { color: '#94a3b8', boxWidth: 12 } },
      tooltip: {
        callbacks: {
          label: (ctx: any) => `${ctx.dataset.label}: ${formatCompact(ctx.raw)}`,
        },
      },
    },
    scales: {
      x: { ticks: { color: '#94a3b8', maxTicksLimit: 8 }, grid: { color: 'rgba(148,163,184,0.1)' } },
      y: {
        ticks: { color: '#94a3b8', callback: (v: number) => formatCompact(v) },
        grid: { color: 'rgba(148,163,184,0.1)' },
      },
    },
  }));

  selectRange(range: string): void {
    this.selectedRange.set(range);
  }
}
