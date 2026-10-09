import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './styles/tokens.css';
import './styles/components.css';
import './styles/base.css';
import './styles/chrome.css';
import './styles/workspace.css';
import './styles/canvas.css';
import './styles/dialogs.css';
import { App } from './ui/App';

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>,
);
