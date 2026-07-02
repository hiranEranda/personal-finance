import { Routes } from '@angular/router';
import { Navbar } from './shared/components/navbar/navbar';
import { Home } from './pages/home/home';
import { Login } from './pages/login/login';
import { ManageFunds } from './pages/manage-funds/manage-funds';
import { NotFound } from './pages/not-found/not-found';
import { Analytics } from './pages/analytics/analytics';
import { Forecast } from './pages/forecast/forecast';
import { Funds } from './pages/funds/funds';
import { FundDetail } from './pages/fund-detail/fund-detail';
import { Compare } from './pages/compare/compare';
import { RagDocuments } from './pages/rag-documents/rag-documents';
import { RagChat } from './pages/rag-chat/rag-chat';
import { Shares } from './pages/shares/shares';
import { FixedDeposits } from './pages/fixed-deposits/fixed-deposits';

export const routes: Routes = [
  // 1. Public / Auth Routes (Standalone)
  { path: 'login', component: Login },

  // 2. Authenticated Routes (Wrapped by Navbar)
  {
    path: '',
    component: Navbar,
    children: [
      { path: 'home', component: Home },
      { path: 'manage-funds', component: ManageFunds },
      { path: 'analytics', component: Analytics },
      { path: 'forecast', component: Forecast },
      { path: 'funds', component: Funds },
      { path: 'shares', component: Shares },
      { path: 'fixed-deposits', component: FixedDeposits },
      { path: 'fund/:id', component: FundDetail },
      { path: 'compare', component: Compare },
      { path: 'documents', component: RagDocuments },
      { path: 'chat', component: RagChat },
      { path: '', redirectTo: 'home', pathMatch: 'full' },
    ],
  },

  // 3. Fallback
  { path: 'not-found', component: NotFound },
  { path: '**', redirectTo: 'not-found' },
];
