import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PickList } from './pick-list';

describe('PickList', () => {
  let component: PickList;
  let fixture: ComponentFixture<PickList>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PickList],
    }).compileComponents();

    fixture = TestBed.createComponent(PickList);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
