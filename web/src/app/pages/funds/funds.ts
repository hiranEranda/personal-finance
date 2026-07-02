import { Component, inject } from '@angular/core';
import { FundService } from '../../shared/services/fund.service';
import { FundsSubnav } from '../../shared/components/funds-subnav/funds-subnav';
import { InvestmentList } from '../../shared/components/investment-list/investment-list';
import { BentoGrid } from '../../shared/components/bento-grid/bento-grid';
import { GrowthGraph } from '../../shared/components/growth-graph/growth-graph';
import { AllocationChart } from '../../shared/components/allocation-chart/allocation-chart';

@Component({
  selector: 'app-funds',
  imports: [FundsSubnav, InvestmentList, BentoGrid, GrowthGraph, AllocationChart],
  templateUrl: './funds.html',
  styleUrl: './funds.css',
})
export class Funds {
  fundService = inject(FundService);
}
