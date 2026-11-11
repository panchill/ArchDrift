import { useCallback, useEffect, useState } from "react";
export type Tab = "graph" | "issues" | "model";
const read = (): Tab => {
  const value = location.hash.slice(2);
  return value === "issues" || value === "model" ? value : "graph";
};
export function useHashTab() {
  const [tab, setTab] = useState<Tab>(read);
  useEffect(() => {
    const sync = () => setTab(read());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const change = useCallback((value: Tab) => { location.hash = `/${value}`; setTab(value); }, []);
  return [tab, change] as const;
}
