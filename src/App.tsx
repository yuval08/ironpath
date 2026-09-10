import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { BarChart3, CalendarDays, Dumbbell, Home, MoreHorizontal } from 'lucide-react';
import { useAppData } from './state/AppDataProvider';
import { useTheme } from './hooks/useTheme';
import { UpdatePrompt } from './components/UpdatePrompt';
import { Disclaimer } from './components/Disclaimer';
import { RecoveryScreen } from './components/RecoveryScreen';
import Dashboard from './screens/Dashboard';
import PlanScreen from './screens/PlanScreen';
import WorkoutScreen from './screens/WorkoutScreen';
import LibraryScreen from './screens/LibraryScreen';
import ProgressScreen from './screens/ProgressScreen';
import MoreScreen from './screens/MoreScreen';
import SettingsScreen from './screens/SettingsScreen';
import ImportScreen from './screens/ImportScreen';
import FinalAssessmentScreen from './screens/FinalAssessmentScreen';
import PullUpScreen from './screens/PullUpScreen';

const TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/plan': 'Your Plan',
  '/workout': "Today's Workout",
  '/library': 'Exercise Library',
  '/progress': 'Progress',
  '/more': 'More',
  '/settings': 'Settings & Backup',
  '/import': 'Import Excel',
  '/assessment': 'Final Assessment',
  '/pull-ups': 'Pull-Ups',
};

export default function App() {
  const { ready, settings, startupError } = useAppData();
  const location = useLocation();
  useTheme(settings?.theme);

  // Nested routes (/workout/:id, /library/:id) inherit their parent's title.
  const title =
    TITLES[location.pathname] ??
    TITLES[`/${location.pathname.split('/')[1] ?? ''}`] ??
    'Ironpath';

  return (
    <div className="app">
      <header className="app-header">
        <h1>{title}</h1>
      </header>

      <main className="app-main">
        {startupError ? (
          <RecoveryScreen error={startupError} title="Could not open your local database" />
        ) : !ready ? (
          <p className="muted">Loading your plan…</p>
        ) : (
          <>
            <Disclaimer />
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/plan" element={<PlanScreen />} />
              <Route path="/workout" element={<WorkoutScreen />} />
              <Route path="/workout/:sessionId" element={<WorkoutScreen />} />
              <Route path="/library" element={<LibraryScreen />} />
              <Route path="/library/:exerciseId" element={<LibraryScreen />} />
              <Route path="/progress" element={<ProgressScreen />} />
              <Route path="/more" element={<MoreScreen />} />
              <Route path="/settings" element={<SettingsScreen />} />
              <Route path="/import" element={<ImportScreen />} />
              <Route path="/assessment" element={<FinalAssessmentScreen />} />
              <Route path="/pull-ups" element={<PullUpScreen />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </>
        )}
      </main>

      <UpdatePrompt />

      <nav className="bottom-nav" aria-label="Primary">
        <NavLink to="/" end>
          <Home size={21} aria-hidden />
          Home
        </NavLink>
        <NavLink to="/plan">
          <CalendarDays size={21} aria-hidden />
          Plan
        </NavLink>
        <NavLink to="/workout">
          <Dumbbell size={21} aria-hidden />
          Workout
        </NavLink>
        <NavLink to="/progress">
          <BarChart3 size={21} aria-hidden />
          Progress
        </NavLink>
        <NavLink to="/more">
          <MoreHorizontal size={21} aria-hidden />
          More
        </NavLink>
      </nav>
    </div>
  );
}
