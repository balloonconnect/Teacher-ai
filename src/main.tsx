import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource/inter/400.css'; import '@fontsource/inter/500.css'; import '@fontsource/inter/600.css'; import '@fontsource/inter/700.css';
import '@fontsource/noto-sans-tamil/400.css'; import '@fontsource/noto-sans-tamil/500.css'; import '@fontsource/noto-sans-tamil/600.css'; import '@fontsource/noto-sans-tamil/700.css';
import App from './App';
import { LangProvider } from './components/lang';
import { AuthProvider } from './auth';
import { ToastProvider } from './components/toast';
import './styles/global.css';
import { setTamilDom } from './i18n/dom';
try { setTamilDom(localStorage.getItem('lang') === 'ta'); } catch { /* storage blocked: English */ }
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><BrowserRouter><LangProvider><ToastProvider><AuthProvider><App /></AuthProvider></ToastProvider></LangProvider></BrowserRouter></React.StrictMode>
);
