import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import App from './App';
import { queryClient } from './lib/queries';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
        <Toaster
          theme="dark"
          position="bottom-center"
          offset={88}
          toastOptions={{ style: { background: '#2b2435', border: '1px solid #3a3146', color: '#efe8dc', fontFamily: 'inherit' } }}
        />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
