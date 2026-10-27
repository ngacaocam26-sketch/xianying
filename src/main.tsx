import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './style.css';

const ShapeStudies = lazy(() => import('./studies/ShapeStudies'));
const ReliefLab = lazy(() => import('./lab/ReliefLab'));
const path = window.location.pathname.replace(/\/$/, '');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {path === '/shape-studies' ? <Suspense fallback={null}><ShapeStudies /></Suspense>
      : path === '/relief-lab' ? <Suspense fallback={null}><ReliefLab /></Suspense> : <App />}
  </StrictMode>,
);
