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
