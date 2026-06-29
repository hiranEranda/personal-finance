import { Component, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FundService } from '../../shared/services/fund.service';
import { SavingStatus } from '../../shared/components/saving-status/saving-status';
import { AdvancedAnalytics } from '../../shared/components/advanced-analytics/advanced-analytics';
import { PortfolioAnalytics } from '../../shared/types/fund.types';

const VIEW_OVERALL = 'overall';

@Component({
  selector: 'app-analytics',
  imports: [FormsModule, SavingStatus, AdvancedAnalytics],
  templateUrl: './analytics.html',
  styleUrl: './analytics.css',
})
export class Analytics {
  fundService = inject(FundService);

  analytics = this.fundService.analytics;
  hasData = computed(() => {
    const a = this.analytics();
    return a && Array.isArray(a.funds) && a.funds.length > 0;
  });

  selectedFundId = signal(VIEW_OVERALL);

  selectedFund = computed(() => {
    if (!this.hasData() || this.selectedFundId() === VIEW_OVERALL) return null;
    return this.analytics().funds.find(f => String(f.fundId) === this.selectedFundId()) ?? null;
  });

  activeAnalytics = computed((): PortfolioAnalytics => {
    const base = this.analytics();
    const fund = this.selectedFund();

    if (!fund) return base;

    return {
      ...base,
      portfolio: {
        totalInvestment: fund.totalInvestment,
        currentValue: fund.currentValue,
        totalGain: fund.totalGain,
        roi: fund.roi,
        cagr: fund.cagr,
        irr: fund.irr,
        holdingYears: fund.holdingYears,
      },
      risk: fund.risk,
      diversification: [{
        type: fund.type || 'Unspecified',
        investment: fund.totalInvestment,
        value: fund.currentValue,
        allocation: fund.currentValue > 0 ? 1 : 0,
      }],
      benchmarks: fund.benchmarkComparisons,
      forecast: {
        perFund: [{ fundId: fund.fundId, name: fund.name, growthAssumption: fund.growthAssumption, oneYear: fund.forecast.oneYear, threeYear: fund.forecast.threeYear, fiveYear: fund.forecast.fiveYear }],
        total: { oneYear: fund.forecast.oneYear, threeYear: fund.forecast.threeYear, fiveYear: fund.forecast.fiveYear },
      },
      tax: fund.tax,
      dividends: { totalDividends: fund.dividends.totalDividends, annualDividend: fund.dividends.annualDividend, dividendYield: fund.dividends.dividendYield },
    };
  });

  activeScope = computed(() => this.selectedFundId() === VIEW_OVERALL ? 'overall' : 'fund');
  activeFundId = computed(() => this.selectedFundId() === VIEW_OVERALL ? null : this.selectedFundId());

  funds = computed(() => this.analytics()?.funds ?? []);

  onScopeChange(value: string): void {
    this.selectedFundId.set(value);
  }
}
