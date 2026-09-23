import { useApp } from '../app/AppContext';

export function Logo({ small = false }: { small?: boolean }) {
  return <div className={small ? 'vsmark sm' : 'vsmark'}><img src="logo.png" alt="VillageSquare" /></div>;
}

export function Wordmark({ small = false }: { small?: boolean }) {
  return (
    <div className="wordmark" style={small ? { fontSize: '16px' } : undefined}>
      <b>villagesquare</b> <span className="meet">meet</span>
    </div>
  );
}

export function ThemeButton() {
  const { toggleTheme } = useApp();
  return (
    <button className="themebtn" onClick={toggleTheme} title="Toggle theme" aria-label="Toggle light or dark theme">
      <span className="material-symbols-rounded t-light">light_mode</span>
      <span className="material-symbols-rounded t-dark">dark_mode</span>
    </button>
  );
}

/** Material Symbols glyph. */
export function Icon({ name, className }: { name: string; className?: string }) {
  return <span className={className ? `material-symbols-rounded ${className}` : 'material-symbols-rounded'}>{name}</span>;
}
