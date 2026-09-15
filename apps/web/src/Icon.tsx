import "./icons/icons.css";

/**
 * Icon from the Lucide web font (ISC license, self-hosted; names: https://lucide.dev/icons).
 * tools/icons.mjs collects all names used here and generates icons/icons.css; unknown names fail the build.
 * Color and size come from the surrounding element (currentColor, font-size).
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
