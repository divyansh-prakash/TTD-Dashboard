import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterOutlet],
  templateUrl: './layout.component.html',
  styleUrl: './layout.component.scss',
})
export class LayoutComponent {
  constructor(private router: Router) {}

  isExploreActive(): boolean {
    const url = this.router.url.split('?')[0];
    return url.startsWith('/explore') || url.startsWith('/platform');
  }

  isDashboardActive(): boolean {
    return this.router.url.split('?')[0].startsWith('/dashboard');
  }
}
