import { Routes } from '@angular/router';
import { LayoutComponent } from './core/components/layout/layout.component';

export const routes: Routes = [
  {
    path: '',
    component: LayoutComponent,
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./core/components/dashboard-2/dashboard-2.component').then(m => m.Dashboard2Component),
      },
      {
        path: 'explore',
        loadComponent: () =>
          import('./core/components/dashboard/dashboard.component').then(m => m.DashboardComponent),
      },
    ],
  },
  {
    path: 'platform/:name',
    loadComponent: () =>
      import('./core/components/platform-detail/platform-detail.component').then(m => m.PlatformDetailComponent),
  },
];
