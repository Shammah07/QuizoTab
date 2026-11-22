// The dashboard's tabs, shared by the page (which reads ?tab= on the server) and the dashboard itself

export const DASHBOARD_TABS = ["overview", "settings", "teams", "scores", "draw", "rooms", "operations", "judges", "share"] as const;
export type DashboardTab = (typeof DASHBOARD_TABS)[number];
export const isDashboardTab = (tab: unknown): tab is DashboardTab => typeof tab === "string" && (DASHBOARD_TABS as readonly string[]).includes(tab);
