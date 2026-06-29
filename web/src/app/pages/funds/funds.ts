import { Component } from '@angular/core';
import { InvestmentList } from '../../shared/components/investment-list/investment-list';

@Component({
  selector: 'app-funds',
  imports: [InvestmentList],
  templateUrl: './funds.html',
  styleUrl: './funds.css',
})
export class Funds {}
