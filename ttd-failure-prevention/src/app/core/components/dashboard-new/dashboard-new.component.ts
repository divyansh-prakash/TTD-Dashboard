import { Component } from '@angular/core';
import { RequestTrendComponent } from './request-trend/request-trend.component';
import { PlatformBreakdownComponent } from './platform-breakdown/platform-breakdown.component';
import { FilterHeaderComponent } from './filter-header/filter-header.component';
import { FailureQueueFilters } from '../../models/failure-queue.model';

@Component({
  selector: 'app-dashboard-new',
  templateUrl: './dashboard-new.component.html',
  styleUrl: './dashboard-new.component.scss',
  imports: [
    FilterHeaderComponent,
    RequestTrendComponent,
    PlatformBreakdownComponent,
  ],
})
export class DashboardNewComponent {
  onFiltersChanged(_filters: FailureQueueFilters): void {}
}
