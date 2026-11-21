import assert from "node:assert/strict";
import { verifyDevDatabase } from "./dev-database";

const directHost = "ep-test-fixture.eu.test.neon.tech";
const pooledHost = directHost.replace(".", "-pooler.");
function fixture(host: string) {
  const url = new URL(`postgresql://${host}/fixture?sslmode=require&channel_binding=require`);
  url.username = "fixture";
  url.password = "fixture";
  return url.href;
}
const local = {
  DEV_NEON_DIRECT_HOST: directHost,
  DEV_NEON_DATABASE: "fixture",
  DATABASE_URL_UNPOOLED: fixture(directHost),
  DATABASE_URL: fixture(pooledHost),
};
assert.deepEqual(verifyDevDatabase(local, local), { direct: local.DATABASE_URL_UNPOOLED, pooled: local.DATABASE_URL });
for (const key of Object.keys(local)) {
  assert.throws(() => verifyDevDatabase({ ...local, [key]: "" }, local), /Set /);
  assert.throws(() => verifyDevDatabase(local, { [key]: "unexpected" }), /conflicts/);
}
for (const changes of [
  { DATABASE_URL_UNPOOLED: local.DATABASE_URL },
  { DATABASE_URL: local.DATABASE_URL_UNPOOLED },
  { DATABASE_URL: local.DATABASE_URL.replace("/fixture?", "/different?") },
  { DEV_NEON_DIRECT_HOST: directHost.replace("ep-test", "ep-other") },
  { DEV_NEON_DIRECT_HOST: pooledHost },
  { DATABASE_URL: local.DATABASE_URL + "&host=elsewhere" },
  { DATABASE_URL: local.DATABASE_URL + "&options=endpoint%3Delsewhere" },
  { DATABASE_URL: local.DATABASE_URL + "&sslmode=disable" },
  { DATABASE_URL: "malformed-sensitive-input" },
]) {
  assert.throws(() => verifyDevDatabase({ ...local, ...changes }, {}), (error: Error) =>
    /^(DATABASE_URL(_UNPOOLED)? must|DEV_NEON_DIRECT_HOST must)/.test(error.message) &&
    !error.message.includes("fixture") && !error.message.includes("sensitive-input"),
  );
}
assert.throws(() => verifyDevDatabase(local, { PGOPTIONS: "unexpected" }), /startup options/);
console.log("Development database target checks passed.");
