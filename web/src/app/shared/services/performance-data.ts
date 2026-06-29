import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, map, Observable, shareReplay, throwError } from 'rxjs';
import { Product } from '../components/pick-list/pick-list';

export interface ChartDataset {
  label: string;
  data: (number | null)[];
  fill?: boolean;
  tension?: number;
  borderColor?: string;
  backgroundColor?: string;
}

export interface ChartData {
  labels: string[];
  datasets: ChartDataset[];
}

@Injectable({
  providedIn: 'root',
})
export class PerformanceData {
  private http = inject(HttpClient);

  // Cache the request: shareReplay(1) keeps the last result in memory
  private data$ = this.http.get<ChartData>('assets/chart-data.json').pipe(
    shareReplay(1),
    catchError((err) => {
      console.error('Error fetching chart data:', err);
      return throwError(() => new Error('Could not load performance data.'));
    }),
  );

  /**
   * Returns labels and datasets filtered by specific fund names
   */
  getFilteredChartData(targetFunds: string[]): Observable<ChartData> {
    return this.data$.pipe(
      map((allData) => ({
        labels: allData.labels,
        datasets: allData.datasets.filter((ds) => targetFunds.includes(ds.label)),
      })),
    );
  }

  /**
   * Returns normalized chart data where each fund's first non-null value
   * is rebased to 100, enabling apples-to-apples comparison of funds
   * with different NAV price levels.
   */
  // getFilteredNormalizedChartData(targetFunds: string[]): Observable<ChartData> {
  //   return this.data$.pipe(
  //     map((allData) => {
  //       const filtered = allData.datasets.filter((ds) => targetFunds.includes(ds.label));

  //       const normalizedDatasets: ChartDataset[] = filtered.map((ds) => {
  //         // Find the first non-null value to use as the base
  //         const baseValue = ds.data.find((v): v is number => v !== null);
  //         if (baseValue == null || baseValue === 0) {
  //           return { ...ds, data: ds.data }; // Can't normalize, return as-is
  //         }

  //         return {
  //           ...ds,
  //           label: ds.label,
  //           data: ds.data.map((v) => (v !== null ? +((v / baseValue) * 100).toFixed(2) : null)),
  //         };
  //       });

  //       return {
  //         labels: allData.labels,
  //         datasets: normalizedDatasets,
  //       };
  //     }),
  //   );
  // }

  getFilteredNormalizedChartData(targetFunds: string[]): Observable<ChartData> {
    return this.data$.pipe(
      map((allData) => {
        const filtered = allData.datasets.filter((ds) => targetFunds.includes(ds.label));

        if (filtered.length === 0) {
          return { labels: allData.labels, datasets: [] };
        }

        // 1. Find the first common index where ALL selected datasets have a non-null value
        const dataLength = filtered[0].data.length;
        let commonBaseIndex = -1;

        for (let i = 0; i < dataLength; i++) {
          const allHaveData = filtered.every((ds) => ds.data[i] !== null);
          if (allHaveData) {
            commonBaseIndex = i;
            break;
          }
        }

        // 2. Normalize the datasets
        const normalizedDatasets: ChartDataset[] = filtered.map((ds) => {
          // Fallback: If funds don't overlap at all, default to the fund's own first available data point
          const baseIndexToUse = commonBaseIndex !== -1
            ? commonBaseIndex
            : ds.data.findIndex((v): v is number => v !== null);

          // Safeguard if dataset is entirely empty or base value is 0
          if (baseIndexToUse === -1 || ds.data[baseIndexToUse] == null || ds.data[baseIndexToUse] === 0) {
            return { ...ds, data: ds.data };
          }

          const baseValue = ds.data[baseIndexToUse] as number;

          return {
            ...ds,
            label: ds.label,
            data: ds.data.map((v) => {
              if (v === null) return null;
              // Rebase to 100
              // return +((v / baseValue) * 100).toFixed(2);
              // Use this for a 0% baseline:
              return +(((v - baseValue) / baseValue) * 100).toFixed(2)
            }),
          };
        });

        return {
          labels: allData.labels,
          datasets: normalizedDatasets,
        };
      })
    );
  }

  /**
   * Returns just a list of fund names (for the Picklist)
   */
  getAllFundNames(): Observable<Product[]> {
    return this.data$.pipe(
      map((allData) =>
        allData.datasets.map((ds, i) => ({
          id: (i + 1).toString(),
          name: ds.label,
        })),
      ),
    );
  }
}
