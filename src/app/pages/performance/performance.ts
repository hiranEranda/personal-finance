import { Component } from '@angular/core';
import { ChartModule } from 'primeng/chart';
import { CompareFundPerformance } from '../../components/compare-fund-performance/compare-fund-performance';

@Component({
  selector: 'app-performance',
  templateUrl: './performance.html',
  styleUrl: './performance.css',
  standalone: true,
  imports: [ChartModule, CompareFundPerformance],
})
export class Performance {}
