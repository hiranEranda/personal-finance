import { Component, inject, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FundService } from '../../shared/services/fund.service';
import { PortfolioService } from '../shares/portfolio.service';
import { FixedDepositsService } from '../../shared/services/fixed-deposits.service';
import { SavingStatus } from '../../shared/components/saving-status/saving-status';
import { PortfolioSummary } from '../../shared/components/portfolio-summary/portfolio-summary';
import { AssetAllocationChart } from '../../shared/components/asset-allocation-chart/asset-allocation-chart';

@Component({
  selector: 'app-home',
  imports: [RouterLink, SavingStatus, PortfolioSummary, AssetAllocationChart],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class Home {
  fundService = inject(FundService);
  portfolioService = inject(PortfolioService);
  fixedDepositsService = inject(FixedDepositsService);

  loading = computed(
    () => this.fundService.loading() || this.portfolioService.loading() || this.fixedDepositsService.loading(),
  );
}
