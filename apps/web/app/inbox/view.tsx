"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "../../components/icon";
import { RefreshButton } from "../../components/refresh-button";
import { Avatar, Badge, EmptyState } from "../../components/ui";
import type { InboxFilter, InboxItem } from "../../lib/bos-api";
import { matchesInboxFilter, selectInboxItems } from "../../lib/inbox-view";
import {
  formatTime,
  laneLabels,
  processingLabels,
  processingTone,
} from "../../lib/presentation";

export function InboxView({
  items,
  filter,
}: {
  items: InboxItem[];
  filter: InboxFilter;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const counts = {
    all: items.length,
    needs_human: items.filter((item) => matchesInboxFilter(item, "needs_human"))
      .length,
    complaints: items.filter((item) => matchesInboxFilter(item, "complaints"))
      .length,
  };
  const processed = items.filter((item) => item.processing === "ready").length;
  const visible = selectInboxItems(items, filter, query, sort);
  const tabs: { value: InboxFilter; label: string }[] = [
    { value: "all", label: "All conversations" },
    { value: "needs_human", label: "Needs review" },
    { value: "complaints", label: "Complaints" },
  ];

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR CUSTOMER WORKSPACE</p>
          <h1>
            Inbox<span className="heading-dot">.</span>
          </h1>
          <p>Less sorting. More meaningful conversations.</p>
        </div>
        <RefreshButton />
      </div>
      <div className="stats-grid">
        <Link href="/inbox" className="stat-card">
          <span className="stat-icon">
            <Icon name="inbox" />
          </span>
          <div>
            <span className="stat-label">Conversations</span>
            <strong>
              {items.length}
              <small>in your inbox</small>
            </strong>
          </div>
        </Link>
        <Link href="/inbox?filter=needs_human" className="stat-card">
          <span className="stat-icon amber">
            <Icon name="alert" />
          </span>
          <div>
            <span className="stat-label">Needs your review</span>
            <strong>
              {counts.needs_human}
              <small>requiring a closer look</small>
            </strong>
          </div>
        </Link>
        <div className="stat-card">
          <span className="stat-icon green">
            <Icon name="check" />
          </span>
          <div>
            <span className="stat-label">Processed</span>
            <strong>
              {processed}
              <small>ready to open</small>
            </strong>
          </div>
        </div>
      </div>
      <section className="panel inbox-panel" aria-label="Conversations">
        <div className="inbox-toolbar">
          <div className="search-field">
            <Icon name="search" size={18} />
            <input
              type="search"
              aria-label="Search conversations"
              placeholder="Search people, subjects or messages…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query ? (
              <button
                type="button"
                className="icon-button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
              >
                <Icon name="close" size={16} />
              </button>
            ) : null}
          </div>
          <label className="sort-control">
            <span className="sr-only">Sort conversations</span>
            <select
              value={sort}
              onChange={(event) =>
                setSort(event.target.value === "oldest" ? "oldest" : "newest")
              }
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </label>
        </div>
        <div className="filter-bar">
          <nav className="filter-tabs" aria-label="Inbox filters">
            {tabs.map((tab) => (
              <Link
                key={tab.value}
                href={
                  tab.value === "all" ? "/inbox" : `/inbox?filter=${tab.value}`
                }
                className={filter === tab.value ? "is-active" : ""}
                aria-current={filter === tab.value ? "page" : undefined}
              >
                {tab.label}
                <span>{counts[tab.value]}</span>
              </Link>
            ))}
          </nav>
        </div>
        <div className="list-caption">
          <span aria-live="polite">
            {visible.length} conversation{visible.length === 1 ? "" : "s"}
            {query ? " found" : ""}
          </span>
          <span>All times in Sydney</span>
        </div>
        {visible.length ? (
          <ul className="inbox-list">
            {visible.map((item) => (
              <li key={item.conversationId}>
                <Link
                  href={`/threads/${item.conversationId}`}
                  className={`inbox-row ${item.urgent ? "is-urgent" : ""}`}
                >
                  <Avatar name={item.from.name || item.from.address} />
                  <div className="inbox-row-body">
                    <div className="row-heading">
                      <strong>{item.from.name || item.from.address}</strong>
                      <time dateTime={item.latestAt}>
                        {formatTime(item.latestAt)}
                      </time>
                    </div>
                    <h2>{item.subject || "No subject"}</h2>
                    <p className="message-preview">
                      {item.preview ||
                        "Open this conversation to see the details."}
                    </p>
                    <div className="row-tags">
                      {item.lane ? (
                        <span className="lane-label">
                          {laneLabels[item.lane]}
                        </span>
                      ) : null}
                      <Badge tone={processingTone(item.processing)}>
                        {item.urgent ? <Icon name="alert" size={12} /> : null}
                        {processingLabels[item.processing]}
                      </Badge>
                      {item.quoteStatus ? (
                        <Badge
                          tone={
                            item.quoteStatus === "accepted"
                              ? "green"
                              : "neutral"
                          }
                        >
                          Quote {item.quoteStatus}
                        </Badge>
                      ) : null}
                      {item.automationPaused ? (
                        <Badge>Manual replies</Badge>
                      ) : null}
                    </div>
                  </div>
                  <Icon name="chevron" size={17} />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={query ? "search" : "inbox"}
            title={
              query
                ? "No matching conversations"
                : filter === "all"
                  ? "Your inbox starts here"
                  : "Nothing in this view"
            }
            description={
              query
                ? "Try a different name, email address or keyword."
                : filter === "all"
                  ? "Incoming customer emails will appear here, organised and ready for you."
                  : "Switch to all conversations to see the rest of your inbox."
            }
          >
            {query ? (
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setQuery("")}
              >
                Clear search
              </button>
            ) : filter !== "all" ? (
              <Link className="button button-secondary" href="/inbox">
                View all conversations
              </Link>
            ) : null}
          </EmptyState>
        )}
      </section>
      <div className="inbox-footnote">
        <Icon name="shield" size={16} />
        <span>Drafts stay drafts until you approve and send them.</span>
      </div>
    </>
  );
}
