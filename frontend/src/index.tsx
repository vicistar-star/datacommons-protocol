import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { WalletProvider } from './wallet/WalletContext';
import NavBar from './components/NavBar';
import MarketplacePage from './pages/MarketplacePage';
import DatasetDetailPage from './pages/DatasetDetailPage';
import MyLicensesPage from './pages/MyLicensesPage';
import RegisterDatasetPage from './pages/RegisterDatasetPage';

const App: React.FC = () => {
  return (
    <WalletProvider>
      <BrowserRouter>
        <NavBar />
        <main style={{ maxWidth: '1200px', margin: '0 auto', padding: '1.5rem 1rem' }}>
          <Routes>
            <Route path="/" element={<MarketplacePage />} />
            <Route path="/dataset/:id" element={<DatasetDetailPage />} />
            <Route path="/licenses" element={<MyLicensesPage />} />
            <Route path="/register" element={<RegisterDatasetPage />} />
          </Routes>
        </main>
      </BrowserRouter>
    </WalletProvider>
  );
};

const container = document.getElementById('root');
if (!container) throw new Error('Root element not found');
createRoot(container).render(<App />);
