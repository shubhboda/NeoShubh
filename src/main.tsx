import { StrictMode, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import LandingPage from './LandingPage.tsx';
import './index.css';

function Root() {
  const [showApp, setShowApp] = useState(() => window.location.pathname === '/consult');

  useEffect(() => {
    const onPop = () => setShowApp(window.location.pathname === '/consult');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const handleEnter = () => {
    window.history.pushState({}, '', '/consult');
    setShowApp(true);
  };

  return showApp
    ? <App />
    : <LandingPage onEnter={handleEnter} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);

