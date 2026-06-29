export const formatNumber = (value: number, decimals = 2): string => {
  if (!Number.isFinite(value)) return '0.00';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

export const formatCompact = (value: number): string => {
  if (!Number.isFinite(value)) return '0';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 10000000) return `${sign}${(abs / 10000000).toFixed(2)}Cr`;
  if (abs >= 100000) return `${sign}${(abs / 100000).toFixed(2)}L`;
  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(1)}K`;
  return `${sign}${abs.toFixed(0)}`;
};

export const safeFormatNumber = (value: number, decimals = 2): string =>
  formatNumber(Number.isFinite(value) ? value : 0, decimals);

export const formatPercent = (value: number, decimals = 2): string => {
  if (!Number.isFinite(value)) return '0.00%';
  return `${(value * 100).toFixed(decimals)}%`;
};
