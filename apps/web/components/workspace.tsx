import Link from "next/link";
import type { ReactNode } from "react";
import { logoutAction } from "../app/session-actions";
import { Icon } from "./icon";
import { SubmitButton } from "./submit-button";
import { Brand } from "./ui";

export function Workspace({
  children,
  active = "inbox",
  section = "Inbox",
}: {
  children: ReactNode;
  active?: "inbox" | "outbox";
  section?: string;
}) {
  return (
    <div className="workspace">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <aside className="sidebar">
        <Link href="/inbox" className="brand-link" aria-label="OwnStack inbox">
          <Brand />
        </Link>
        <div className="workspace-label">
          <span className="workspace-monogram">W</span>
          <span>
            <strong>Your workspace</strong>
            <small>Owner access</small>
          </span>
        </div>
        <p className="nav-caption">WORKSPACE</p>
        <nav aria-label="Main navigation" className="main-nav">
          <Link
            href="/inbox"
            className={`nav-link ${active === "inbox" ? "is-active" : ""}`}
            aria-current={active === "inbox" ? "page" : undefined}
          >
            <Icon name="inbox" />
            Inbox
            <Icon name="chevron" size={14} />
          </Link>
          <Link
            href="/outbox"
            className={`nav-link ${active === "outbox" ? "is-active" : ""}`}
            aria-current={active === "outbox" ? "page" : undefined}
          >
            <Icon name="send" />
            Outbox
          </Link>
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <Icon name="shield" />
            <strong>You’re in control</strong>
            <p>
              Review drafts and approve replies before they enter the outbox.
            </p>
          </div>
          <div className="owner-profile">
            <span className="avatar avatar-0">O</span>
            <span>
              <strong>Workspace owner</strong>
              <small>Operator console</small>
            </span>
          </div>
          <form action={logoutAction}>
            <SubmitButton variant="secondary" pendingLabel="Signing out…">
              <Icon name="logout" size={16} />
              Sign out
            </SubmitButton>
          </form>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span>
            <strong>{section}</strong>
          </div>
          <span className="topbar-label">
            <Icon name="shield" size={15} />
            Owner workspace
          </span>
        </header>
        <main id="main-content" className="page-content">
          {children}
        </main>
        <footer className="workspace-footer">
          <span>OwnStack BOS</span>
          <span>A clearer view of your customer conversations.</span>
        </footer>
      </div>
    </div>
  );
}
