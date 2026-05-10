import { TestBed } from '@angular/core/testing';

import { PerformanceData } from './performance-data';

describe('PerformanceData', () => {
  let service: PerformanceData;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PerformanceData);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
