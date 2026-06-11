import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  { path: 'platform/:name', renderMode: RenderMode.Client },
  { path: 'dashboard',      renderMode: RenderMode.Client },
  { path: 'explore',        renderMode: RenderMode.Client },
  { path: '',               renderMode: RenderMode.Client },
  { path: '**',             renderMode: RenderMode.Client },
];
