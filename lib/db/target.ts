// Shared by CLI and runtime. Parser errors can include credentials; expose only field names.
export function pinnedNeonUrl(value:string, host:string, database:string, pooled:boolean, key:string, role?:string, hostLabel="Pinned host") {
  if (!/^ep-[a-z0-9-]+(?:\.[a-z0-9-]+)+\.neon\.tech$/.test(host) || host.split(".")[0].endsWith("-pooler"))
    throw new Error(hostLabel+" must be a full direct Neon endpoint hostname.");
  if (!/^[a-zA-Z0-9_-]+$/.test(database)) throw new Error("Unsupported pinned database name.");
  try {
    const url=new URL(value);
    const user=decodeURIComponent(url.username);
    const expected=pooled ? host.replace(".","-pooler.") : host;
    const tls=url.searchParams.get("sslmode");
    const permitted=[...url.searchParams.keys()].every(k=>["sslmode","channel_binding"].includes(k) && url.searchParams.getAll(k).length===1);
    if (["postgres:","postgresql:"].includes(url.protocol) && user && (!role || user===role) &&
      decodeURIComponent(url.password) && url.hostname===expected && (!url.port || url.port==="5432") &&
      url.pathname==="/"+database && !url.hash && permitted && (tls==="require" || tls==="verify-full") &&
      (!role || !url.searchParams.has("channel_binding") || url.searchParams.get("channel_binding")==="require")) return url.href;
  } catch { /* Never propagate a URL or a parser exception. */ }
  throw new Error(key+" must be a TLS PostgreSQL URL for the pinned host, database and role.");
}
