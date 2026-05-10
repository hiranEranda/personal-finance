import { Component, computed, input } from '@angular/core';
import { ChartModule } from 'primeng/chart';
import { chartType } from '../../types/types';
import { ChartData } from '../../services/performance-data';

@Component({
  selector: 'app-chart',
  imports: [ChartModule],
  templateUrl: './chart.html',
  styleUrl: './chart.css',
})
export class Chart {
  data = input<ChartData | null>(null);
  chartType = input<chartType>('line');

  // Computed signal for styled data
  styledData = computed(() => {
    const rawData = this.data();
    if (!rawData) return null;

    // Deep clone to avoid mutating original data (which might be shared/cached)
    const chartData: ChartData = JSON.parse(JSON.stringify(rawData));
    const documentStyle = getComputedStyle(document.documentElement);

    const colors = ['--p-cyan-500', '--p-orange-500', '--p-purple-500', '--p-green-500'];
    chartData.datasets.forEach((ds, i) => {
      const colorVar = colors[i % colors.length];
      const colorValue = documentStyle.getPropertyValue(colorVar).trim();
      ds.borderColor = colorValue || colorVar;
      ds.backgroundColor = colorValue || colorVar;
      ds.tension = 0.4;
      ds.fill = false;
    });

    return chartData;
  });

  // Computed signal for chart options
  options = computed(() => {
    const documentStyle = getComputedStyle(document.documentElement);
    const textColor = documentStyle.getPropertyValue('--p-text-color');
    const textColorSecondary = documentStyle.getPropertyValue('--p-text-muted-color');
    const surfaceBorder = documentStyle.getPropertyValue('--p-content-border-color');

    return {
      maintainAspectRatio: false,
      aspectRatio: 0.6,
      plugins: {
        legend: {
          labels: { color: textColor },
        },
        tooltip: {
          mode: 'index',
          intersect: false,
        },
      },
      scales: {
        x: {
          ticks: { color: textColorSecondary },
          grid: { color: surfaceBorder },
        },
        y: {
          ticks: { color: textColorSecondary },
          grid: { color: surfaceBorder },
          title: {
            display: true,
            text: 'NAV Per Unit (LKR)',
            color: textColor,
          },
        },
      },
    };
  });
}
