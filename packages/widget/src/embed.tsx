import React from 'react';
import ReactDOM from 'react-dom/client';
import EmbedApp from './EmbedApp';
import './index.css';

const params = new URLSearchParams(window.location.search);
const tenantId = params.get('tenant') ?? 'demo';
const theme = params.get('theme') ?? 'light';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <EmbedApp tenantId={tenantId} theme={theme} />
  </React.StrictMode>
);
