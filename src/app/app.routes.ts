import { Routes } from '@angular/router';
import { Navbar } from './shared/components/navbar/navbar';
import { Home } from './pages/home/home';
import { Login } from './pages/login/login';
import { ManageFunds } from './pages/manage-funds/manage-funds';
import { NotFound } from './pages/not-found/not-found';
import { Performance } from './pages/performance/performance';

export const routes: Routes = [
  // 1. Public / Auth Routes (Standalone)
  { path: 'login', component: Login },

  // 2. Authenticated Routes (Wrapped by Navbar)
  {
    path: '',
    component: Navbar, // This component contains the Navbar + <router-outlet>
    children: [
      { path: 'home', component: Home },
      { path: 'manage-funds', component: ManageFunds },
      { path: 'performance', component: Performance },
      { path: '', redirectTo: 'home', pathMatch: 'full' },
    ],
  },

  // 3. Fallback redirect\
  { path: 'not-found', component: NotFound },
  { path: '**', redirectTo: 'not-found' },
];
