import { Component, OnInit, inject, signal, computed, DestroyRef } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ChartModule } from 'primeng/chart';
import { PerformanceData, ChartData } from '../../shared/services/performance-data';
import { PickList, Product } from '../../shared/components/pick-list/pick-list';
import { Chart } from '../../shared/components/chart/chart';
import { chartType } from '../../shared/types/types';
import { ChartType } from '../../shared/types/enums';
import { switchMap } from 'rxjs';

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

  // Initial target funds list
  private initialTargetNames = [
    'CAL Quant Equity Fund',
    'NDB Wealth Growth Fund',
    'CAL Fixed Income Opportunities Fund',
    'NDB Wealth Income Fund',
  ];

  // Derive the names for filtering from the chosen list signal
  targetFundsNames = computed(() => this.chosenList().map((f) => f.name));

  // Reactive chart data based on targetFundsNames
  chartData = toSignal<ChartData>(
    toObservable(this.targetFundsNames).pipe(
      switchMap((names) => this.performanceData.getFilteredChartData(names)),
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

  onChosenItemsChange(event: Product[]) {
    // Update the chosen list, which will trigger the chartData signal update
    this.chosenList.set(event);
  }
}
