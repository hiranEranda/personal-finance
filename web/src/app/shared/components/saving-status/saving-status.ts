import { Component, inject } from '@angular/core';
import { FundService } from '../../services/fund.service';

@Component({
  selector: 'app-saving-status',
  imports: [],
  templateUrl: './saving-status.html',
  styleUrl: './saving-status.css',
})
export class SavingStatus {
  fundService = inject(FundService);
}
