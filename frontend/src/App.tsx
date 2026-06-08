import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import AppLayout from './components/layout/AppLayout'
import LoginPage from './pages/Auth/LoginPage'
import DashboardPage from './pages/Dashboard/DashboardPage'
import ClientsPage from './pages/Clients/ClientsPage'
import ClientDetailPage from './pages/Clients/ClientDetailPage'
import LocalDetailPage from './pages/Clients/LocalDetailPage'
import SensorDetailPage from './pages/Clients/SensorDetailPage'
import ContactDetailPage from './pages/Clients/ContactDetailPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<AppLayout />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/clients" element={<ClientsPage />} />
          <Route path="/clients/:clientId" element={<ClientDetailPage />} />
          <Route path="/clients/:clientId/cpds/:cpdId" element={<LocalDetailPage />} />
          <Route path="/clients/:clientId/cpds/:cpdId/devices/:deviceId" element={<SensorDetailPage />} />
          <Route path="/clients/:clientId/contacts/:contactId" element={<ContactDetailPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
