import { Component, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FixedDepositsService } from '../../shared/services/fixed-deposits.service';
import { FixedDeposit, PayoutFrequency, FixedDepositStatus } from '../../shared/types/fixed-deposit.types';
import { addMonths, monthsBetween, toDateInputString } from '../../shared/utils/fixed-deposit-calculations';

@Component({
  selector: 'app-fixed-deposits',
  imports: [DecimalPipe],
  templateUrl: './fixed-deposits.html',
  styleUrl: './fixed-deposits.css',
})
export class FixedDeposits {
  fixedDepositsService = inject(FixedDepositsService);

  showModal = signal(false);
  editing = signal<FixedDeposit | null>(null);

  formBankName = signal('');
  // null (not 0/'') so the input's placeholder stays visible until the user types.
  formPrincipal = signal<number | null>(null);
  formInterestRate = signal<number | null>(null);
  formStartDate = signal('');
  formMonths = signal<number | null>(null);
  formPayoutFrequency = signal<PayoutFrequency>('at_maturity');
  formStatus = signal<FixedDepositStatus>('active');
  formNotes = signal('');

  openAddModal(): void {
    this.editing.set(null);
    this.formBankName.set('');
    this.formPrincipal.set(null);
    this.formInterestRate.set(null);
    this.formStartDate.set('');
    this.formMonths.set(null);
    this.formPayoutFrequency.set('at_maturity');
    this.formStatus.set('active');
    this.formNotes.set('');
    this.showModal.set(true);
  }

  openEditModal(fd: FixedDeposit): void {
    this.editing.set(fd);
    this.formBankName.set(fd.bankName);
    this.formPrincipal.set(fd.principal);
    this.formInterestRate.set(fd.interestRate);
    this.formStartDate.set(fd.startDate);
    this.formMonths.set(monthsBetween(new Date(fd.startDate), new Date(fd.maturityDate)));
    this.formPayoutFrequency.set(fd.payoutFrequency);
    this.formStatus.set(fd.status);
    this.formNotes.set(fd.notes);
    this.showModal.set(true);
  }

  save(): void {
    const startDate = this.formStartDate();
    const months = this.formMonths() ?? 0;
    const maturityDate = startDate ? toDateInputString(addMonths(new Date(startDate), months)) : '';

    const payload = {
      bankName: this.formBankName(),
      principal: this.formPrincipal() ?? 0,
      interestRate: this.formInterestRate() ?? 0,
      startDate,
      maturityDate,
      payoutFrequency: this.formPayoutFrequency(),
      status: this.formStatus(),
      notes: this.formNotes(),
    };

    const current = this.editing();
    if (current) {
      this.fixedDepositsService.edit({ ...payload, id: current.id });
    } else {
      this.fixedDepositsService.add(payload);
    }
    this.showModal.set(false);
  }

  remove(id: string): void {
    if (confirm('Delete this fixed deposit?')) {
      this.fixedDepositsService.delete(id);
    }
  }
}
