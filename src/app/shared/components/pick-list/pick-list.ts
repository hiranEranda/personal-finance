import { Component, input, model, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PickListModule } from 'primeng/picklist';

export interface Product {
  id: string;
  name: string;
  image?: string;
  category?: string;
  price?: number;
}

@Component({
  selector: 'app-picklist',
  standalone: true,
  imports: [PickListModule, CommonModule],
  templateUrl: './pick-list.html',
  styleUrl: './pick-list.css',
})
export class PickList {
  sourceProducts = model<Product[]>([]);
  targetProducts = model<Product[]>([]);
  chosenItems = output<Product[]>();
  hideMoveAllButton = false;

  onMoveToTarget(event: any) {
    // PrimeNG mutates the arrays in-place via push/splice.
    // The event only contains { items }, NOT source/target arrays.
    // We create new array references from the already-mutated arrays
    // so Angular's signal system detects the change.
    this.sourceProducts.set([...this.sourceProducts()]);
    this.targetProducts.set([...this.targetProducts()]);
    this.chosenItems.emit(this.targetProducts());
  }

  onMoveToSource(event: any) {
    this.sourceProducts.set([...this.sourceProducts()]);
    this.targetProducts.set([...this.targetProducts()]);
    this.chosenItems.emit(this.targetProducts());
  }

  onSourceSelect(event: any) {
    this.hideMoveAllButton = this.targetProducts().length + event.items.length >= 10;
  }
}
