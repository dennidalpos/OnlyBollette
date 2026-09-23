import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

document.documentElement.dataset.theme =
  localStorage.getItem('onlybollette-theme') === 'light' ? 'light' : 'dark';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
