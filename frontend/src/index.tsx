import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import MarketplacePage from './pages/MarketplacePage';
import DatasetDetailPage from './pages/DatasetDetailPage';
import MyLicensesPage from './pages/MyLicensesPage';
import RegisterDatasetPage from './pages/RegisterDatasetPage';

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<MarketplacePage />} />
        <Route path="/dataset/:id" element={<DatasetDetailPage />} />
        <Route path="/licenses" element={<MyLicensesPage />} />
        <Route path="/register" element={<RegisterDatasetPage />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;