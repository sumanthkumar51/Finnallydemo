import { Routes } from '@angular/router';
import { authGuard } from './core/auth';
import { Shell } from './layout/shell';
import { Login } from './pages/login';

export const routes: Routes = [
  { path: 'login', component: Login, title: 'Sign in · Finnally CRM' },
  {
    path: '',
    component: Shell,
    canActivate: [authGuard],
    canActivateChild: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      { path: 'dashboard', loadComponent: () => import('./pages/dashboard').then((m) => m.Dashboard), title: 'Dashboard · Finnally CRM' },
      { path: 'employees', loadComponent: () => import('./pages/employees').then((m) => m.Employees), title: 'Employees · Finnally CRM' },
      { path: 'employees/:id', loadComponent: () => import('./pages/employee-detail').then((m) => m.EmployeeDetail), title: 'Employee · Finnally CRM' },
      { path: 'finances', loadComponent: () => import('./pages/finances').then((m) => m.Finances), title: 'Finances · Finnally CRM' },
      { path: 'logins', loadComponent: () => import('./pages/logins').then((m) => m.Logins), title: 'Login activity · Finnally CRM' },
      {
        path: 'activity', data: { roles: ['admin', 'manager'] },
        loadComponent: () => import('./pages/activity').then((m) => m.Activity), title: 'Usage & audit · Finnally CRM',
      },
      { path: 'map', loadComponent: () => import('./pages/office-map').then((m) => m.OfficeMap), title: 'Offices · Finnally CRM' },
      { path: 'profile', loadComponent: () => import('./pages/profile').then((m) => m.Profile), title: 'My profile · Finnally CRM' },
    ],
  },
  { path: '**', redirectTo: '' },
];
