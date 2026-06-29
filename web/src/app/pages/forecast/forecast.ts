import { Component, inject, signal, computed, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ChartModule } from 'primeng/chart';
import { FundService } from '../../shared/services/fund.service';
import { SavingStatus } from '../../shared/components/saving-status/saving-status';
import {
  predictNaive, predictMovingAverage, predictLinear, predictExponential, predictLogistic, findBestFitModel,
} from '../../shared/utils/forecasting';
import { formatCompact } from '../../shared/utils/formatters';
import { PortfolioFund } from '../../shared/types/fund.types';

@Component({
  selector: 'app-forecast',
  imports: [FormsModule, ChartModule, SavingStatus],
  templateUrl: './forecast.html',
  styleUrl: './forecast.css',
})
export class Forecast {
  private fundService = inject(FundService);

  funds = this.fundService.portfolioData;

  yearsToForecast = signal(5);
  stepUpRate = signal(10);
  selectedModel = signal('Best Fit');
  capacity = signal(50000000);
  viewMode = signal<'combined' | 'individual'>('combined');
  fundSIPs = signal<Record<string, number>>({});
  private sipInitialized = false;

  models = ['Best Fit', 'Linear', 'Exponential', 'Logistic', 'Moving Average', 'Naive'];

  constructor() {
    effect(() => {
      const funds = this.funds();
      if (!funds.length || this.sipInitialized) return;
      const totalValue = funds.reduce((s, f) => s + f.currentValue, 0);
      if (totalValue <= 0) return;
      const initial: Record<string, number> = {};
      const defaultTotal = 50000;
      funds.forEach(f => { initial[f.id] = Math.round(defaultTotal * (f.currentValue / totalValue)); });
      this.fundSIPs.set(initial);
      this.sipInitialized = true;
    });
  }

  totalSIP = computed(() => Object.values(this.fundSIPs()).reduce((s, v) => s + (v || 0), 0));

  private buildNavSeries(fund: PortfolioFund): number[] {
    const navHistory = Array.isArray(fund.navHistory) ? fund.navHistory : [];
    let navSeries = navHistory.filter(e => e.nav > 0)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .map(e => e.nav);
    if (navSeries.length < 3) {
      const txNavs = (fund.transactions || []).filter(t => t.nav > 0)
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .map(t => t.nav);
      navSeries = [...navSeries, ...txNavs];
    }
    if (fund.currentNav > 0 && (!navSeries.length || navSeries[navSeries.length - 1] !== fund.currentNav)) {
      navSeries.push(fund.currentNav);
    }
    if (navSeries.length < 2) navSeries = [fund.currentNav || 10, fund.currentNav || 10];
    return navSeries;
  }

  private runModel(navSeries: number[], periods: number): { forecast: number[]; model: string } {
    switch (this.selectedModel()) {
      case 'Naive': return { forecast: predictNaive(navSeries, periods), model: 'Naive' };
      case 'Moving Average': return { forecast: predictMovingAverage(navSeries, periods, 3), model: 'Moving Average' };
      case 'Linear': return { forecast: predictLinear(navSeries, periods), model: 'Linear' };
      case 'Exponential': return { forecast: predictExponential(navSeries, periods), model: 'Exponential' };
      case 'Logistic': return { forecast: predictLogistic(navSeries, periods, this.capacity()), model: 'Logistic' };
      default: return findBestFitModel(navSeries, periods, this.capacity());
    }
  }

  private historicalData = computed(() => {
    const funds = this.funds();
    if (!funds.length) return { timeline: [], currentValue: 0 };

    const monthNavMap = new Map<string, { date: Date; fundNavs: Record<string, number> }>();
    funds.forEach(fund => {
      (fund.navHistory || []).forEach(entry => {
        const d = new Date(entry.date);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (!monthNavMap.has(key)) monthNavMap.set(key, { date: new Date(d.getFullYear(), d.getMonth(), 1), fundNavs: {} });
        monthNavMap.get(key)!.fundNavs[fund.id] = entry.nav;
      });
      (fund.transactions || []).forEach(tx => {
        const d = new Date(tx.date);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (!monthNavMap.has(key)) monthNavMap.set(key, { date: new Date(d.getFullYear(), d.getMonth(), 1), fundNavs: {} });
        const existing = monthNavMap.get(key)!;
        if (!existing.fundNavs[fund.id] && tx.nav > 0) existing.fundNavs[fund.id] = tx.nav;
      });
    });

    const sortedMonths = Array.from(monthNavMap.entries()).sort(([a], [b]) => a.localeCompare(b));
    const timeline: { label: string; value: number }[] = [];

    sortedMonths.forEach(([, val]) => {
      let total = 0;
      funds.forEach(fund => {
        const nav = val.fundNavs[fund.id];
        if (nav) {
          const units = (fund.transactions || []).filter(tx => new Date(tx.date) <= val.date)
            .reduce((s, t) => s + t.units, 0);
          total += nav * units;
        }
      });
      if (total > 0) {
        timeline.push({ label: val.date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }), value: total });
      }
    });

    const currentValue = funds.reduce((s, f) => s + f.currentValue, 0);
    return { timeline, currentValue };
  });

  forecastResult = computed(() => {
    const { timeline, currentValue } = this.historicalData();
    const funds = this.funds();
    const periods = this.yearsToForecast() * 12;

    if (!funds.length || currentValue <= 0) {
      return { data: [], perFund: [], modelName: 'N/A', totalSIPInvested: 0, finalValue: 0, totalReturns: 0, annualizedRate: 0 };
    }

    const fundDetails = funds.map(fund => {
      const navSeries = this.buildNavSeries(fund);
      return { fund, navSeries, currentValue: fund.currentValue, totalUnits: fund.transactions.reduce((s, t) => s + t.units, 0) };
    }).filter(fd => fd.currentValue > 0);

    const totalValue = fundDetails.reduce((s, fd) => s + fd.currentValue, 0);

    const perFundForecasts = fundDetails.map(fd => {
      const { forecast, model } = this.runModel(fd.navSeries, periods);
      const lastHistNav = fd.navSeries[fd.navSeries.length - 1];
      const finalNav = forecast[forecast.length - 1] || lastHistNav;
      const annualRate = periods > 0 ? Math.pow(Math.max(finalNav / lastHistNav, 1), 12 / periods) - 1 : 0;
      return { ...fd, model, annualRate, predictedNavs: forecast, lastHistNav, fundSIP: this.fundSIPs()[fd.fund.id] || 0 };
    });

    const fundUnits = perFundForecasts.map(pf => pf.totalUnits);
    const currentFundSIPs = perFundForecasts.map(pf => pf.fundSIP);
    const now = new Date();
    const combinedForecast: { label: string; value: number }[] = [];

    for (let i = 0; i < periods; i++) {
      let monthTotal = 0;
      perFundForecasts.forEach((pf, idx) => {
        const predNav = Math.max(pf.predictedNavs[i] || pf.predictedNavs[pf.predictedNavs.length - 1] || pf.fund.currentNav, 0.01);
        fundUnits[idx] += currentFundSIPs[idx] / predNav;
        monthTotal += fundUnits[idx] * predNav;
      });
      if ((i + 1) % 12 === 0) currentFundSIPs.forEach((_, idx) => { currentFundSIPs[idx] *= (1 + this.stepUpRate() / 100); });
      const futureDate = new Date(now.getFullYear(), now.getMonth() + i + 1, 1);
      combinedForecast.push({ label: futureDate.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }), value: monthTotal });
    }

    const sipTotals = perFundForecasts.map(pf => {
      let total = 0; let sip = pf.fundSIP;
      for (let i = 1; i <= periods; i++) { total += sip; if (i % 12 === 0) sip *= (1 + this.stepUpRate() / 100); }
      return total;
    });
    const totalSIPInvested = sipTotals.reduce((s, v) => s + v, 0);
    const finalValue = combinedForecast[combinedForecast.length - 1]?.value ?? currentValue;
    const weightedRate = perFundForecasts.reduce((s, pf) => s + pf.annualRate * (pf.currentValue / totalValue), 0);

    return {
      data: combinedForecast,
      perFund: perFundForecasts.map((pf, idx) => ({
        fundId: pf.fund.id, name: pf.fund.name, type: pf.fund.type, model: pf.model, annualRate: pf.annualRate,
        currentValue: pf.currentValue, fundSIP: pf.fundSIP, sipContribution: sipTotals[idx],
        finalValue: fundUnits[idx] * (pf.predictedNavs[pf.predictedNavs.length - 1] || pf.fund.currentNav),
        returns: fundUnits[idx] * (pf.predictedNavs[pf.predictedNavs.length - 1] || pf.fund.currentNav) - pf.currentValue - sipTotals[idx],
      })),
      modelName: this.selectedModel() === 'Best Fit'
        ? `Per-Fund Best Fit (${perFundForecasts.map(p => p.model).join(', ')})`
        : this.selectedModel(),
      annualizedRate: weightedRate,
      totalSIPInvested,
      finalValue,
      totalReturns: finalValue - currentValue - totalSIPInvested,
    };
  });

  chartData = computed(() => {
    const { timeline, currentValue } = this.historicalData();
    const forecast = this.forecastResult();
    const now = new Date();
    const bridgeLabel = now.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });

    const histLabels = [...timeline.map(h => h.label), bridgeLabel];
    const histValues = [...timeline.map(h => h.value), currentValue];
    const projLabels = [bridgeLabel, ...forecast.data.filter((_, i) => i % 3 === 2 || i === forecast.data.length - 1).map(f => f.label)];
    const projValues = [currentValue, ...forecast.data.filter((_, i) => i % 3 === 2 || i === forecast.data.length - 1).map(f => f.value)];

    const allLabels = [...new Set([...histLabels, ...projLabels])].sort();

    return {
      labels: allLabels,
      datasets: [
        {
          label: 'Portfolio Value',
          data: allLabels.map(l => histLabels.includes(l) ? histValues[histLabels.lastIndexOf(l)] : null),
          borderColor: '#3B82F6',
          backgroundColor: 'transparent',
          tension: 0.4,
          pointRadius: 2,
          borderWidth: 3,
          spanGaps: false,
        },
        {
          label: 'Projected Value',
          data: allLabels.map(l => projLabels.includes(l) ? projValues[projLabels.lastIndexOf(l)] : null),
          borderColor: '#10B981',
          backgroundColor: 'rgba(16,185,129,0.1)',
          borderDash: [6, 3],
          tension: 0.4,
          fill: true,
          pointRadius: 0,
          borderWidth: 3,
          spanGaps: false,
        },
      ],
    };
  });

  chartOptions = computed(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: '#94a3b8' } },
      tooltip: { callbacks: { label: (ctx: any) => `${ctx.dataset.label}: ${formatCompact(ctx.raw)}` } },
    },
    scales: {
      x: { ticks: { color: '#94a3b8', maxRotation: 35, maxTicksLimit: 12 }, grid: { color: 'rgba(148,163,184,0.1)' } },
      y: { ticks: { color: '#94a3b8', callback: (v: number) => formatCompact(v) }, grid: { color: 'rgba(148,163,184,0.1)' } },
    },
  }));

  updateFundSIP(fundId: string, value: string): void {
    this.fundSIPs.update(sips => ({ ...sips, [fundId]: Number(value) || 0 }));
  }

  fmt(val: number): string {
    if (!Number.isFinite(val)) return '0';
    return val.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }
  formatCompact = formatCompact;
  currentPortfolioValue = computed(() => this.historicalData().currentValue);
}
