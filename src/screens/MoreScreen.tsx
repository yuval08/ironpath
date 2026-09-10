import { useNavigate } from 'react-router-dom';
import { Award, BookOpen, ClipboardCheck, FileSpreadsheet, Settings } from 'lucide-react';
import { DisclaimerText } from '@/components/Disclaimer';

const LINKS = [
  {
    to: '/library',
    label: 'Exercise Library',
    hint: 'Every movement, with instructions and videos',
    Icon: BookOpen,
  },
  {
    to: '/pull-ups',
    label: 'Pull-Ups',
    hint: 'Band assistance ladder and pull-up progress',
    Icon: Award,
  },
  {
    to: '/assessment',
    label: 'Final Assessment',
    hint: 'End-of-plan testing form',
    Icon: ClipboardCheck,
  },
  {
    to: '/import',
    label: 'Import Old Excel Tracker',
    hint: 'Pull starting weights from a previous file',
    Icon: FileSpreadsheet,
  },
  {
    to: '/settings',
    label: 'Settings & Backup',
    hint: 'Theme, units, export, reset',
    Icon: Settings,
  },
];

export default function MoreScreen() {
  const navigate = useNavigate();
  return (
    <div>
      <div className="card flush">
        {LINKS.map(({ to, label, hint, Icon }) => (
          <button key={to} className="list-item" onClick={() => navigate(to)}>
            <Icon size={19} aria-hidden />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{label}</div>
              <div className="muted tiny">{hint}</div>
            </div>
          </button>
        ))}
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 6 }}>Safety</h3>
        <DisclaimerText />
      </div>
    </div>
  );
}
