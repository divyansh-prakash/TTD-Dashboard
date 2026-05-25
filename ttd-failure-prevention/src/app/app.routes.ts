import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  {
    path: 'dashboard',
    loadComponent: () =>
      import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent),
    children: [
      { path: '', redirectTo: 'failure-queue/by-platform', pathMatch: 'full' },
      {
        path: 'failure-queue',
        children: [
          { path: '', redirectTo: 'by-platform', pathMatch: 'full' },
          {
            path: 'by-platform',
            loadComponent: () =>
              import('./features/failure-queue/by-platform/by-platform.component').then(
                (m) => m.ByPlatformComponent
              ),
          },
        ],
      },
    ],
  },
];
