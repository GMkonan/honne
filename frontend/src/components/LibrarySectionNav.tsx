interface LibrarySectionNavProps {
  active: "collection" | "monthly_log";
}

const sections = [
  { id: "collection", label: "Collection", href: "#library" },
  { id: "monthly_log", label: "Monthly Log", href: "#monthly-log" },
] as const;

export function LibrarySectionNav({ active }: LibrarySectionNavProps) {
  return (
    <nav className="library-section-nav" aria-label="Library sections">
      {sections.map((section) => (
        <a
          key={section.id}
          className={active === section.id ? "active" : ""}
          href={section.href}
          aria-current={active === section.id ? "page" : undefined}
        >
          {section.label}
        </a>
      ))}
    </nav>
  );
}
