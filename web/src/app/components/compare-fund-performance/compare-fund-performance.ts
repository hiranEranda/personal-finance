import { Component, OnInit, inject, signal, computed, DestroyRef } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ChartModule } from 'primeng/chart';
import { PerformanceData, ChartData } from '../../shared/services/performance-data';
import { PickList, Product } from '../../shared/components/pick-list/pick-list';
import { Chart } from '../../shared/components/chart/chart';
import { chartType } from '../../shared/types/types';
import { ChartType } from '../../shared/types/enums';
import { combineLatest, switchMap } from 'rxjs';

@Component({
  selector: 'app-compare-fund-performance',
  templateUrl: './compare-fund-performance.html',
  styleUrl: './compare-fund-performance.css',
  standalone: true,
  imports: [ChartModule, PickList, Chart],
})
export class CompareFundPerformance implements OnInit {
  private performanceData = inject(PerformanceData);
  private destroyRef = inject(DestroyRef);

  sourceProducts = signal<Product[]>([]);
  chosenList = signal<Product[]>([]);
  chartType: chartType = ChartType.Line;

  /** Toggle between raw NAV and normalized (rebased to 100) view */
  normalized = signal(false);

  // Initial target funds list
  private initialTargetNames = [
    'CAL Quant Equity Fund',
    'NDB Wealth Growth Fund',
    'CAL Fixed Income Opportunities Fund',
    'NDB Wealth Income Fund',
  ];

  // Derive the names for filtering from the chosen list signal
  targetFundsNames = computed(() => this.chosenList().map((f) => f.name));

  // Y-axis label changes based on the view mode
  yAxisLabel = computed(() => (this.normalized() ? 'Normalized (Base = 100)' : 'NAV Per Unit (LKR)'));

  // Reactive chart data: switches between raw and normalized based on the toggle
  chartData = toSignal<ChartData>(
    combineLatest([toObservable(this.targetFundsNames), toObservable(this.normalized)]).pipe(
      switchMap(([names, isNormalized]) =>
        isNormalized
          ? this.performanceData.getFilteredNormalizedChartData(names)
          : this.performanceData.getFilteredChartData(names),
      ),
    ),
  );

  ngOnInit() {
    // Load all fund names once and initialize source/target lists
    this.performanceData
      .getAllFundNames()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((allFunds) => {
        const initialTargets = allFunds.filter((f) => this.initialTargetNames.includes(f.name));
        const initialSources = allFunds.filter((f) => !this.initialTargetNames.includes(f.name));

        this.chosenList.set(initialTargets);
        this.sourceProducts.set(initialSources);
      });
  }

  toggleNormalized() {
    this.normalized.update((v) => !v);
  }

  onChosenItemsChange(event: Product[]) {
    // Update the chosen list, which will trigger the chartData signal update
    this.chosenList.set(event);
  }
}
