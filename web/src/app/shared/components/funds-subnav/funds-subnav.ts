import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-funds-subnav',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './funds-subnav.html',
  styleUrl: './funds-subnav.css',
})
export class FundsSubnav {
  readonly tabs = [
    { path: '/funds', label: 'Funds' },
    { path: '/manage-funds', label: 'Manage' },
    { path: '/analytics', label: 'Analytics' },
    { path: '/compare', label: 'Compare' },
    { path: '/forecast', label: 'Forecast' },
  ];
}
