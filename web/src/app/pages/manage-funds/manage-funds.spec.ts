import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ManageFunds } from './manage-funds';

describe('ManageFunds', () => {
  let component: ManageFunds;
  let fixture: ComponentFixture<ManageFunds>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ManageFunds],
    }).compileComponents();

    fixture = TestBed.createComponent(ManageFunds);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
