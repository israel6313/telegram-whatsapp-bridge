import { Routes } from '@angular/router';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { SettingsComponent } from './components/settings/settings.component';
import { LogViewerComponent } from './components/log-viewer/log-viewer.component';

export const routes: Routes = [
    { path: '', component: DashboardComponent },
    { path: 'settings', component: SettingsComponent },
    { path: 'logs', component: LogViewerComponent },
    { path: '**', redirectTo: '' },
];
