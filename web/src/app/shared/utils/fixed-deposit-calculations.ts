import { FixedDeposit, FixedDepositWithValue } from '../types/fixed-deposit.types';

export const monthsBetween = (start: Date, end: Date): number =>
  (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());

export const addMonths = (date: Date, months: number): Date => {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
};

export const toDateInputString = (date: Date): string => date.toISOString().split('T')[0];

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const daysBetween = (start: Date, end: Date): number => Math.round((end.getTime() - start.getTime()) / MS_PER_DAY);

// Actual/365 simple interest: principal * rate * (actual days held / 365).
const maturityValueFor = (fd: FixedDeposit): number => {
  const days = daysBetween(new Date(fd.startDate), new Date(fd.maturityDate));
  return fd.principal + fd.principal * (fd.interestRate / 100) * (days / 365);
};

const hasMatured = (fd: FixedDeposit): boolean => new Date() >= new Date(fd.maturityDate);

export const withComputedValues = (fd: FixedDeposit): FixedDepositWithValue => {
  const maturityValue = maturityValueFor(fd);

  // FDs can't be cashed out early, so there's no accrued value to realize before
  // maturity — net worth only counts the principal until the maturity date is
  // actually reached, then the full matured value. Withdrawn FDs contribute
  // nothing (the cash has already left this account).
  let currentValue: number;
  if (fd.status === 'withdrawn') {
    currentValue = 0;
  } else if (fd.status === 'matured' || hasMatured(fd)) {
    currentValue = maturityValue;
  } else {
    currentValue = fd.principal;
  }

  return { ...fd, maturityValue, currentValue };
};
