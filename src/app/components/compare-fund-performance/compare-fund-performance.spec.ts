import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CompareFundPerformance } from './compare-fund-performance';

describe('CompareFundPerformance', () => {
  let component: CompareFundPerformance;
  let fixture: ComponentFixture<CompareFundPerformance>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CompareFundPerformance],
    }).compileComponents();

    fixture = TestBed.createComponent(CompareFundPerformance);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
