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
  yAxisLabel = input<string>('NAV Per Unit (LKR)');

  // Computed signal for styled data
  styledData = computed(() => {
    const rawData = this.data();
    if (!rawData) return null;

    // Deep clone to avoid mutating original data (which might be shared/cached)
    const chartData: ChartData = JSON.parse(JSON.stringify(rawData));
    const documentStyle = getComputedStyle(document.documentElement);

    // 1. Expand your base CSS variables (Assuming standard PrimeNG/Tailwind naming)
    const baseColors = [
      '--p-cyan-500', '--p-orange-500', '--p-purple-500', '--p-green-500',
      '--p-blue-500', '--p-pink-500', '--p-yellow-500', '--p-teal-500',
      '--p-red-500', '--p-indigo-500', '--p-lime-500', '--p-rose-500',
      '--p-fuchsia-500', '--p-emerald-500', '--p-sky-500', '--p-amber-500'
    ];

    chartData.datasets.forEach((ds, i) => {
      let finalColor: string;

      if (i < baseColors.length) {
        // 2. Use your predefined theme colors first
        const colorVar = baseColors[i];
        finalColor = documentStyle.getPropertyValue(colorVar).trim() || colorVar;
      } else {
        // 3. Dynamic generation for anything beyond the base palette
        // We multiply the index by the Golden Angle (~137.5 degrees).
        // This ensures every generated hue is spaced out nicely across the color wheel.
        const hue = (i * 137.508) % 360;
        finalColor = `hsl(${hue}, 75%, 50%)`;
      }

      ds.borderColor = finalColor;
      ds.backgroundColor = finalColor;
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
            text: this.yAxisLabel(),
            color: textColor,
          },
        },
      },
    };
  });
}
