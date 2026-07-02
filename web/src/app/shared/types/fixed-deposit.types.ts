export type PayoutFrequency = 'at_maturity' | 'monthly' | 'quarterly';
export type FixedDepositStatus = 'active' | 'matured' | 'withdrawn';

export interface FixedDeposit {
  id: string;
  bankName: string;
  principal: number;
  interestRate: number; // annual %, e.g. 12.5
  startDate: string;
  maturityDate: string;
  payoutFrequency: PayoutFrequency;
  status: FixedDepositStatus;
  notes: string;
}

export interface FixedDepositWithValue extends FixedDeposit {
  maturityValue: number;
  // Principal until the maturity date is reached (early withdrawal isn't
  // possible), then the full maturityValue; 0 if withdrawn.
  currentValue: number;
}
