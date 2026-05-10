import { Component, inject, signal } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { ThemeService } from '../../services/theme';

@Component({
  selector: 'app-navbar',
  imports: [RouterLink, RouterOutlet],
  templateUrl: './navbar.html',
  styleUrl: './navbar.css',
})
export class Navbar {
  themeService = inject(ThemeService);
  isMenuOpen = signal(false);

  toggleDarkMode() {
    this.themeService.toggleDarkMode();
  }

  toggleMenu() {
    this.isMenuOpen.update((v) => !v);
  }
}
