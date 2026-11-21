// Each mounted spectator scope owns one poller. Invalidate outstanding responses
// before navigating or unmounting, including responses already being decoded.
export function spectatorRefresh<T>(load: () => Promise<Response>, apply: (value: T | null) => void, stale: () => void) {
  let generation = 0;
  let active = false;
  return {
    cancel() { generation++; active = false; },
    async refresh() {
      if (active) return;
      active = true;
      const request = ++generation;
      try {
        const response = await load();
        if (generation !== request) return;
        if ([401,403,404,410].includes(response.status)) return apply(null);
        if (!response.ok) return stale();
        const value: T = await response.json();
        if (generation === request) apply(value);
      } catch {
        if (generation === request) stale();
      } finally {
        if (generation === request) active = false;
      }
    },
  };
}
