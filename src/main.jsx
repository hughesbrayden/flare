import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Story from './story/Story.jsx';
import App from './App.jsx';
import './styles.css';
import './story/story.css';
import './story/mobile.css';

function Root() {
  const [path, setPath] = useState(() => window.location.pathname);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = (next) => {
    if (next === path) return;
    window.history.pushState({}, '', next);
    setPath(next);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  if (path === '/demo' || path === '/demo/') {
    return <App embedded={false} onNavigate={navigate} />;
  }
  return <Story onNavigate={navigate} />;
}

createRoot(document.getElementById('root')).render(<Root />);
