const mean = (data: number[]): number => data.reduce((a, b) => a + b, 0) / data.length;

const calculateMSE = (actual: number[], predicted: number[]): number => {
  if (actual.length !== predicted.length) return Infinity;
  const sumSqErr = actual.reduce((sum, val, i) => sum + Math.pow(val - predicted[i], 2), 0);
  return sumSqErr / actual.length;
};

export const predictNaive = (data: number[], periods: number): number[] => {
  const lastValue = data[data.length - 1];
  return Array(periods).fill(lastValue);
};

export const predictMovingAverage = (data: number[], periods: number, windowSize = 3): number[] => {
  if (data.length < windowSize) return predictNaive(data, periods);
  const result: number[] = [];
  const currentWindow = data.slice(-windowSize);
  for (let i = 0; i < periods; i++) {
    const nextVal = mean(currentWindow);
    result.push(nextVal);
    currentWindow.shift();
    currentWindow.push(nextVal);
  }
  return result;
};

export const predictLinear = (data: number[], periods: number): number[] => {
  const n = data.length;
  const x = Array.from({ length: n }, (_, i) => i);
  const y = data;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
  const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  const result: number[] = [];
  for (let i = 1; i <= periods; i++) {
    result.push(slope * (n - 1 + i) + intercept);
  }
  return result;
};

export const predictExponential = (data: number[], periods: number): number[] => {
  if (data.some(d => d <= 0)) return predictLinear(data, periods);
  const n = data.length;
  const x = Array.from({ length: n }, (_, i) => i);
  const yLog = data.map(val => Math.log(val));
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumYLog = yLog.reduce((a, b) => a + b, 0);
  const sumXYLog = x.reduce((sum, xi, i) => sum + xi * yLog[i], 0);
  const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);
  const slope = (n * sumXYLog - sumX * sumYLog) / (n * sumXX - sumX * sumX);
  const intercept = (sumYLog - slope * sumX) / n;
  const a = Math.exp(intercept);
  const r = Math.exp(slope) - 1;
  const result: number[] = [];
  for (let i = 1; i <= periods; i++) {
    result.push(a * Math.pow(1 + r, n - 1 + i));
  }
  return result;
};

export const predictLogistic = (data: number[], periods: number, capacity: number | null = null): number[] => {
  const maxVal = Math.max(...data);
  const L = capacity || maxVal * 2;
  const n = data.length;
  const validDataItems = data.map((d, i) => ({ val: d, idx: i })).filter(item => item.val < L && item.val > 0);
  if (validDataItems.length < 2) return predictLinear(data, periods);
  const cleanX = validDataItems.map(item => item.idx);
  const cleanY = validDataItems.map(item => item.val);
  const z = cleanY.map(y => Math.log(L / y - 1));
  const sumX = cleanX.reduce((a, b) => a + b, 0);
  const sumZ = z.reduce((a, b) => a + b, 0);
  const sumXZ = cleanX.reduce((sum, xi, i) => sum + xi * z[i], 0);
  const sumXX = cleanX.reduce((sum, xi) => sum + xi * xi, 0);
  const count = cleanX.length;
  const slope = (count * sumXZ - sumX * sumZ) / (count * sumXX - sumX * sumX);
  const intercept = (sumZ - slope * sumX) / count;
  const k = -slope;
  const x0 = intercept / slope;
  const result: number[] = [];
  for (let i = 1; i <= periods; i++) {
    const t = n - 1 + i;
    result.push(L / (1 + Math.exp(-k * (t - x0))));
  }
  return result;
};

export interface ForecastModelResult {
  model: string;
  mse?: number;
  forecast: number[];
}

export const findBestFitModel = (data: number[], periods: number, capacity: number | null = null): ForecastModelResult => {
  if (data.length < 5) {
    return { model: 'Linear (Fallback)', forecast: predictLinear(data, periods) };
  }
  const splitIndex = Math.floor(data.length * 0.8);
  const trainData = data.slice(0, splitIndex);
  const testData = data.slice(splitIndex);
  const testPeriods = testData.length;

  const models = [
    { name: 'Naive', predict: (d: number[], p: number) => predictNaive(d, p) },
    { name: 'Moving Average (3)', predict: (d: number[], p: number) => predictMovingAverage(d, p, 3) },
    { name: 'Linear', predict: (d: number[], p: number) => predictLinear(d, p) },
    { name: 'Exponential', predict: (d: number[], p: number) => predictExponential(d, p) },
  ];

  if (capacity) {
    models.push({ name: 'Logistic', predict: (d: number[], p: number) => predictLogistic(d, p, capacity) });
  }

  let bestModel = models[0];
  let minMSE = Infinity;

  models.forEach(model => {
    const predictions = model.predict(trainData, testPeriods);
    const mse = calculateMSE(testData, predictions);
    if (mse < minMSE) {
      minMSE = mse;
      bestModel = model;
    }
  });

  return {
    model: bestModel.name,
    mse: minMSE,
    forecast: bestModel.predict(data, periods),
  };
};
