import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import { App } from './app.tsx';

const el = document.getElementById('root');
if (!el) throw new Error('root element missing');
createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
