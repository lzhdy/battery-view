import React from 'react';
import { Route, Routes } from 'react-router-dom';

import Layout from './components/Layout';
import AppWindow from './pages/AppWindow';
import NotFound from './pages/NotFound/NotFound';

const RoutesComponent = () => {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<AppWindow />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

export default RoutesComponent;
