import "./icons/icons.css";

/**
 * Symbol aus dem Lucide-Webfont (ISC-Lizenz, selbst gehostet; Namen: https://lucide.dev/icons).
 * tools/icons.mjs sammelt alle hier verwendeten Namen und erzeugt icons/icons.css; unbekannte Namen brechen den Build ab.
 * Farbe und Groesse kommen vom umgebenden Element (currentColor, font-size).
 */
export function Icon({ name, className, title, rotate }: { name: string; className?: string; title?: string; rotate?: number }) {
  return (
    <i
      className={`ic ic-${name}${className ? ` ${className}` : ""}`}
      title={title}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      style={rotate ? { transform: `rotate(${rotate}deg)` } : undefined}
    />
  );
}
