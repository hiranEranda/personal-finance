import { Component, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FundService } from '../../shared/services/fund.service';
import { SavingStatus } from '../../shared/components/saving-status/saving-status';
import { FundsSubnav } from '../../shared/components/funds-subnav/funds-subnav';
import { DepositSync } from '../../shared/components/deposit-sync/deposit-sync';
import { Fund, Transaction } from '../../shared/types/fund.types';

@Component({
  selector: 'app-manage-funds',
  imports: [FormsModule, SavingStatus, FundsSubnav, DepositSync],
  templateUrl: './manage-funds.html',
  styleUrl: './manage-funds.css',
})
export class ManageFunds {
  fundService = inject(FundService);

  funds = this.fundService.portfolioData;

  showFundModal = signal(false);
  fundToEdit = signal<Fund | null>(null);
  transactionFundId = signal<string | null>(null);

  fundForTransactions = computed(() =>
    this.funds().find(f => f.id === this.transactionFundId()) ?? null
  );

  // Fund form state
  formName = signal('');
  formType = signal<Fund['type']>('Equity');
  fundTypes: Fund['type'][] = ['Equity', 'Debt', 'Income', 'Money Market', 'Hybrid'];

  // Transaction sub-page state
  showTransactionModal = signal(false);
  transactionToEdit = signal<(Transaction & { index: number }) | null>(null);
  manualNav = signal(0);

  // Transaction form state
  txDate = signal(new Date().toISOString().split('T')[0]);
  txAmount = signal('');
  txNav = signal('');

  openAddFundModal(): void {
    this.fundToEdit.set(null);
    this.formName.set('');
    this.formType.set('Equity');
    this.showFundModal.set(true);
  }

  openEditFundModal(fund: Fund): void {
    this.fundToEdit.set(fund);
    this.formName.set(fund.name);
    this.formType.set(fund.type);
    this.showFundModal.set(true);
  }

  saveFund(): void {
    const name = this.formName().trim();
    if (!name) return;
    const existing = this.fundToEdit();
    if (existing) {
      this.fundService.editFund({ ...existing, name, type: this.formType() });
    } else {
      this.fundService.addFund({ name, type: this.formType(), currentNav: 0, transactions: [] });
    }
    this.showFundModal.set(false);
  }

  deleteFund(fundId: string): void {
    if (confirm('Delete this fund and all its transactions?')) {
      this.fundService.deleteFund(fundId);
    }
  }

  openTransactions(fundId: string): void {
    const fund = this.funds().find(f => f.id === fundId);
    if (fund) this.manualNav.set(fund.currentNav);
    this.transactionFundId.set(fundId);
  }

  backToFundList(): void {
    this.transactionFundId.set(null);
  }

  updateNav(): void {
    const fundId = this.transactionFundId();
    if (fundId) this.fundService.updateFundTransactions(fundId, { currentNav: this.manualNav() });
  }

  openAddTransactionModal(): void {
    this.transactionToEdit.set(null);
    this.txDate.set(new Date().toISOString().split('T')[0]);
    this.txAmount.set('');
    this.txNav.set('');
    this.showTransactionModal.set(true);
  }

  openEditTransactionModal(tx: Transaction, index: number): void {
    this.transactionToEdit.set({ ...tx, index });
    this.txDate.set(tx.date);
    this.txAmount.set(String(tx.amount));
    this.txNav.set(String(tx.nav));
    this.showTransactionModal.set(true);
  }

  saveTransaction(): void {
    const amount = parseFloat(this.txAmount());
    const nav = parseFloat(this.txNav());
    if (!amount || !nav || amount <= 0 || nav <= 0) return;

    const fundId = this.transactionFundId();
    if (!fundId) return;

    const fund = this.fundForTransactions();
    if (!fund) return;

    const txData: Transaction = { date: this.txDate(), amount, nav, units: amount / nav };
    let newTransactions: Transaction[];

    const editing = this.transactionToEdit();
    if (editing !== null && editing.index !== undefined) {
      newTransactions = fund.transactions.map((t, i) => i === editing.index ? txData : t);
    } else {
      newTransactions = [...fund.transactions, txData];
    }

    const sorted = [...newTransactions].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const latestNav = sorted[0]?.nav ?? fund.currentNav;

    this.fundService.updateFundTransactions(fundId, { transactions: newTransactions, currentNav: latestNav });
    this.showTransactionModal.set(false);
  }

  deleteTransaction(index: number): void {
    const fundId = this.transactionFundId();
    const fund = this.fundForTransactions();
    if (!fundId || !fund) return;

    const newTransactions = fund.transactions.filter((_, i) => i !== index);
    const sorted = [...newTransactions].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const latestNav = sorted[0]?.nav ?? 0;

    this.fundService.updateFundTransactions(fundId, { transactions: newTransactions, currentNav: latestNav });
  }

  fmt(value: number): string {
    return (Number.isFinite(value) ? value : 0).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
}
