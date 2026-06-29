import { Component, input, signal, computed } from '@angular/core';
import { PortfolioAnalytics } from '../../types/fund.types';
import { safeFormatNumber, formatPercent } from '../../utils/formatters';

@Component({
  selector: 'app-advanced-analytics',
  imports: [],
  templateUrl: './advanced-analytics.html',
  styleUrl: './advanced-analytics.css',
})
export class AdvancedAnalytics {
  analytics = input.required<PortfolioAnalytics>();
  scope = input<string>('overall');
  selectedFundId = input<string | null>(null);

  expandedSections = signal<string[]>([]);

  hasData = computed(() => {
    const a = this.analytics();
    return a && Array.isArray(a.funds) && a.funds.length > 0;
  });

  portfolioData = computed(() => this.analytics()?.portfolio ?? {
    totalInvestment: 0, currentValue: 0, totalGain: 0, roi: 0, cagr: 0, irr: 0, holdingYears: 0,
  });

  riskData = computed(() => this.analytics()?.risk ?? { volatility: 0, downsideDeviation: 0, maxDrawdown: 0 });
  diversificationData = computed(() => this.analytics()?.diversification ?? []);
  benchmarkRows = computed(() => this.analytics()?.benchmarks ?? []);
  forecastData = computed(() => this.analytics()?.forecast ?? { total: { oneYear: 0, threeYear: 0, fiveYear: 0 }, perFund: [] });
  taxData = computed(() => this.analytics()?.tax ?? { longTermGain: 0, shortTermGain: 0, longTermTax: 0, shortTermTax: 0 });
  dividendData = computed(() => this.analytics()?.dividends ?? { totalDividends: 0, annualDividend: 0, dividendYield: 0 });

  isFundScope = computed(() => this.scope() === 'fund' && !!this.selectedFundId());

  topFunds = computed(() => {
    if (!this.hasData()) return [];
    const funds = this.analytics().funds.filter(f => Number.isFinite(f.roi));
    if (this.isFundScope() && this.selectedFundId()) {
      return funds.filter(f => String(f.fundId) === this.selectedFundId());
    }
    return [...funds].sort((a, b) => b.roi - a.roi).slice(0, 3);
  });

  underperformers = computed(() => {
    if (!this.hasData()) return [];
    const funds = this.analytics().funds.filter(f => Number.isFinite(f.roi));
    if (this.isFundScope() && this.selectedFundId()) {
      return funds.filter(f => String(f.fundId) === this.selectedFundId());
    }
    return [...funds].sort((a, b) => a.roi - b.roi).slice(0, 3);
  });

  isExpanded(section: string): boolean {
    return this.expandedSections().includes(section);
  }

  toggleSection(section: string): void {
    this.expandedSections.update(sections =>
      sections.includes(section) ? sections.filter(s => s !== section) : [...sections, section]
    );
  }

  highlightFund(fundId: string): boolean {
    return !!this.selectedFundId() && String(fundId) === this.selectedFundId();
  }

  fmt = safeFormatNumber;
  pct = formatPercent;
}
