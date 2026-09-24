import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import Shell from './components/Shell';
import VerifyPage from './pages/VerifyPage';

const PatientsPage = lazy(() => import('./pages/PatientsPage'));
const ScreenPage = lazy(() => import('./pages/ScreenPage'));
const DrugPage = lazy(() => import('./pages/DrugPage'));
const DrugIndexPage = lazy(() => import('./pages/DrugIndexPage'));
const SignalsPage = lazy(() => import('./pages/SignalsPage'));
const AuditPage = lazy(() => import('./pages/AuditPage'));
const SystemPage = lazy(() => import('./pages/SystemPage'));

export default function App() {
  return (
    <Shell>
      <Suspense fallback={<div className="page"><div className="skeleton" style={{ height: 240 }} /></div>}>
        <Routes>
          <Route path="/" element={<Navigate to="/verify" replace />} />
          <Route path="/verify" element={<VerifyPage />} />
          <Route path="/patients" element={<PatientsPage />} />
          <Route path="/screen" element={<ScreenPage />} />
          <Route path="/drugs" element={<DrugIndexPage />} />
          <Route path="/drugs/:name" element={<DrugPage />} />
          <Route path="/signals" element={<SignalsPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/system" element={<SystemPage />} />
          <Route path="*" element={<Navigate to="/verify" replace />} />
        </Routes>
      </Suspense>
    </Shell>
  );
}
