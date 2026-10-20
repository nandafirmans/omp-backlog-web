import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import App from './App';
import './styles.css';

const router = createBrowserRouter([
  '/', '/settings', '/plan', '/projects/new', '/projects/:repoId',
  '/projects/:repoId/tickets/new', '/projects/:repoId/tickets/:ticketId',
  '/runs/:runId', '*',
].map(path => ({ path, Component: App })));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
