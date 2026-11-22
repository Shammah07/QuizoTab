// One tab retains only an opaque ID and a digest. Points, reasons and receipts stay on the server.
export async function scoreRequest(storage: Pick<Storage,"getItem"|"setItem">, scope:string, path:string, body:object) {
  const bytes = await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify([scope,path,body])));
  const key = "quizotab.staff."+Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,"0")).join("");
  const requestId = storage.getItem(key) ?? crypto.randomUUID();
  storage.setItem(key,requestId);
  return {key,requestId};
}

export class StaffRequests {
  private generation = 0;
  private sending = false;
  read() {
    const version = ++this.generation;
    return () => version === this.generation;
  }
  invalidate() { this.generation++; }
  begin() {
    if (this.sending) return false;
    this.sending = true;
    this.invalidate();
    return true;
  }
  finish() { this.sending = false; }
  get busy() { return this.sending; }
}
