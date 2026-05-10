import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  darkMode = signal<boolean>(false);

  constructor() {
    this.initializeTheme();
  }

  private initializeTheme() {
    const savedTheme = localStorage.getItem('app-theme');

    if (savedTheme === 'dark') {
      this.setDarkMode(true);
    } else {
      // Default to light mode if no preference is saved
      this.setDarkMode(false);
    }
  }

  toggleDarkMode() {
    this.setDarkMode(!this.darkMode());
  }

  private setDarkMode(isDark: boolean) {
    this.darkMode.set(isDark);

    if (isDark) {
      // Triggers both Tailwind and PrimeNG dark modes instantly
      document.documentElement.classList.add('dark');
      localStorage.setItem('app-theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('app-theme', 'light');
    }
  }
}
