import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Receptionist from './pages/Receptionist';
import WaitingRoom from './pages/WaitingRoom';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/receptionist" replace />} />
        <Route path="/receptionist" element={<Receptionist />} />
        <Route path="/waiting" element={<WaitingRoom />} />
      </Routes>
    </BrowserRouter>
  );
}
