import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FundService } from '../../shared/services/fund.service';
import { SavingStatus } from '../../shared/components/saving-status/saving-status';
import { BentoGrid } from '../../shared/components/bento-grid/bento-grid';
import { GrowthGraph } from '../../shared/components/growth-graph/growth-graph';
import { AllocationChart } from '../../shared/components/allocation-chart/allocation-chart';
import { InvestmentList } from '../../shared/components/investment-list/investment-list';

@Component({
  selector: 'app-home',
  imports: [RouterLink, SavingStatus, BentoGrid, GrowthGraph, AllocationChart, InvestmentList],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class Home {
  fundService = inject(FundService);
}
