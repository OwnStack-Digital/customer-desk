"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Icon } from "./icon";

export function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      className="button button-secondary"
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      <Icon name="refresh" size={16} />
      {pending ? "Refreshing…" : "Refresh"}
    </button>
  );
}
