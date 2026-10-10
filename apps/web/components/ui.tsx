import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon";

export function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark">
        <Icon name="leaf" size={23} />
      </span>
      <span>
        ownstack<span className="brand-dot">.</span>
        <small>BUSINESS OPERATIONS</small>
      </span>
    </span>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "green" | "amber" | "red" | "blue";
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function EmptyState({
  title,
  description,
  icon = "inbox",
  children,
}: {
  title: string;
  description: string;
  icon?: IconName;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name={icon} size={28} />
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {children}
    </div>
  );
}

export function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  const color =
    [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 5;
  return (
    <span className={`avatar avatar-${color}`} aria-hidden="true">
      {initials}
    </span>
  );
}
