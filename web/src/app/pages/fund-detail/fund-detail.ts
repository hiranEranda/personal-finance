import { Component, inject, computed, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ChartModule } from 'primeng/chart';
import { FundService } from '../../shared/services/fund.service';
import { FundHero } from '../../shared/components/fund-hero/fund-hero';
import { formatNumber, formatCompact, formatPercent } from '../../shared/utils/formatters';

const TIME_RANGES = ['All Time', '5 Years', '1 Year', '6 Months', '3 Months', '1 Month'];

@Component({
  selector: 'app-fund-detail',
  imports: [ChartModule, FundHero],
  templateUrl: './fund-detail.html',
  styleUrl: './fund-detail.css',
})
export class FundDetail {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private fundService = inject(FundService);

  timeRanges = TIME_RANGES;
  selectedRange = signal('All Time');

  fundId = computed(() => this.route.snapshot.paramMap.get('id') ?? '');

  fund = computed(() =>
    this.fundService.portfolioData().find(f => String(f.id) === this.fundId()) ?? null
  );

  fundAnalytics = computed(() => {
    const analytics = this.fundService.analytics();
    if (!analytics?.funds) return null;
    return analytics.funds.find(f => String(f.fundId) === this.fundId()) ?? null;
  });

  chartData = computed(() => {
    const fund = this.fund();
    if (!fund?.transactions) return { labels: [], datasets: [] };

    const sorted = [...fund.transactions].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    let cumulativeUnits = 0;

    const allData = sorted.map(t => {
      cumulativeUnits += t.units;
      return { dateStr: t.date, date: new Date(t.date).toLocaleDateString('en-CA'), nav: t.nav, value: cumulativeUnits * t.nav };
    });

    allData.push({ dateStr: new Date().toISOString(), date: 'Current', nav: fund.currentNav, value: fund.totalUnits * fund.currentNav });

    let filtered = allData;
    const range = this.selectedRange();
    if (range !== 'All Time') {
      const now = new Date();
      const pastDate = new Date();
      if (range === '5 Years') pastDate.setFullYear(now.getFullYear() - 5);
      else if (range === '1 Year') pastDate.setFullYear(now.getFullYear() - 1);
      else if (range === '6 Months') pastDate.setMonth(now.getMonth() - 6);
      else if (range === '3 Months') pastDate.setMonth(now.getMonth() - 3);
      else if (range === '1 Month') pastDate.setMonth(now.getMonth() - 1);
      filtered = allData.filter(d => d.date === 'Current' || new Date(d.dateStr) >= pastDate);
    }

    return {
      labels: filtered.map(d => d.date),
      datasets: [{
        label: 'Fund Value',
        data: filtered.map(d => d.value),
        fill: true,
        borderColor: '#6366F1',
        backgroundColor: 'rgba(99,102,241,0.15)',
        tension: 0.4,
        pointRadius: 3,
        borderWidth: 2,
      }],
    };
  });

  chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (ctx: any) => `Value: ${formatNumber(ctx.raw)}` } },
    },
    scales: {
      x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(148,163,184,0.1)' } },
      y: { ticks: { color: '#94a3b8', callback: (v: number) => formatCompact(v) }, grid: { color: 'rgba(148,163,184,0.1)' } },
    },
  };

  goBack(): void { this.router.navigate(['/funds']); }

  pct(value: number): string {
    if (!Number.isFinite(value)) return '-';
    return new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: 2 }).format(value);
  }

  fmt = formatNumber;
  Math = Math;
  sortByDateDesc = (a: { date: string }, b: { date: string }) => new Date(b.date).getTime() - new Date(a.date).getTime();
}
