import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FixedDeposit, FixedDepositWithValue } from '../types/fixed-deposit.types';
import { withComputedValues } from '../utils/fixed-deposit-calculations';

const API_URL = 'http://localhost:3001/api/fixed-deposits';

@Injectable({ providedIn: 'root' })
export class FixedDepositsService {
  private http = inject(HttpClient);

  private _deposits = signal<FixedDeposit[]>([]);
  private _loading = signal(true);
  private _error = signal<string | null>(null);

  readonly deposits = this._deposits.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  readonly depositsWithValues = computed((): FixedDepositWithValue[] => this._deposits().map(withComputedValues));

  readonly totals = computed(() => {
    const data = this.depositsWithValues();
    const totalPrincipal = data.reduce((acc, fd) => acc + fd.principal, 0);
    const currentValue = data.reduce((acc, fd) => acc + fd.currentValue, 0);
    return { totalPrincipal, currentValue, totalGain: currentValue - totalPrincipal };
  });

  constructor() {
    this.load();
  }

  load(): void {
    this._loading.set(true);
    this.http.get<FixedDeposit[]>(API_URL).subscribe({
      next: (deposits) => {
        this._deposits.set(deposits);
        this._error.set(null);
        this._loading.set(false);
      },
      error: () => {
        this._error.set('Could not load fixed deposits. Please ensure the server is running.');
        this._loading.set(false);
      },
    });
  }

  add(fd: Omit<FixedDeposit, 'id'>): void {
    this.http.post<FixedDeposit>(API_URL, fd).subscribe({
      next: (created) => this._deposits.update((deposits) => [created, ...deposits]),
      error: () => this._error.set('Failed to add fixed deposit.'),
    });
  }

  edit(fd: FixedDeposit): void {
    this.http.put<FixedDeposit>(`${API_URL}/${fd.id}`, fd).subscribe({
      next: (updated) => this._deposits.update((deposits) => deposits.map((d) => (d.id === updated.id ? updated : d))),
      error: () => this._error.set('Failed to update fixed deposit.'),
    });
  }

  delete(id: string): void {
    this.http.delete(`${API_URL}/${id}`).subscribe({
      next: () => this._deposits.update((deposits) => deposits.filter((d) => d.id !== id)),
      error: () => this._error.set('Failed to delete fixed deposit.'),
    });
  }
}
