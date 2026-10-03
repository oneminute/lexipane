export type AppView = "library" | "reader" | "notebook" | "ai";

interface Props {
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  onOpenBook: () => void;
}

const navItems: Array<{ id: AppView; label: string; icon: string }> = [
  { id: "library", label: "Library", icon: "▦" },
  { id: "reader", label: "Reader", icon: "◫" },
  { id: "notebook", label: "Notebook", icon: "✎" },
  { id: "ai", label: "AI & Models", icon: "✦" },
];

export function AppSidebar({ activeView, onNavigate, onOpenBook }: Props) {
  return (
    <aside className="sidebar">
      <button className="brand" onClick={() => onNavigate("library")}>
        <span className="brand-mark">L</span>
        <span>
          <strong>LexiPane</strong>
          <small>AI Reading Workspace</small>
        </span>
      </button>

      <button className="primary-button sidebar-open" onClick={onOpenBook}>
        <span>＋</span> Open book
      </button>

      <nav className="nav-list" aria-label="Main navigation">
        {navItems.map((item) => (
          <button
            key={item.id}
            className={activeView === item.id ? "nav-item active" : "nav-item"}
            onClick={() => onNavigate(item.id)}
          >
            <span className="nav-icon">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <span className="privacy-dot" />
        <span>
          <strong>Local-first</strong>
          <small>Books and notes stay on device</small>
        </span>
      </div>
    </aside>
  );
}
