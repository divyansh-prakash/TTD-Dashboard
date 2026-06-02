import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { FailureQueueFilters } from '../../models/failure-queue.model';
import { TrendGraphComponent } from './trend-graph/trend-graph.component';
import { PlatformQueueComponent } from './platform-queue/platform-queue.component';
import { FilterHeaderComponent } from '../dashboard-new/filter-header/filter-header.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, TrendGraphComponent, PlatformQueueComponent, FilterHeaderComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent {
  private defaultFilters(): FailureQueueFilters {
    const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    return { dateFrom: y, dateTo: y, platforms: [], channel: '', brandSafe: 'all' };
  }

  appliedFilters: FailureQueueFilters = this.defaultFilters();

  onFiltersChanged(filters: FailureQueueFilters): void {
    this.appliedFilters = filters;
  }
}
