import dns from "node:dns";
import { syncBuiltinESMExports } from "node:module";

const loopback = { address: "127.0.0.1", family: 4 };
const isLocalhostName = (hostname) => typeof hostname === "string" && /\.localhost\.?$/i.test(hostname);
const originalLookup = dns.lookup;
const originalPromiseLookup = dns.promises.lookup;

dns.lookup = function lookup(hostname, options, callback) {
  if (!isLocalhostName(hostname)) return originalLookup.call(this, hostname, options, callback);
  const done = typeof options === "function" ? options : callback;
  const all = typeof options === "object" && options !== null && options.all === true;
  if (all) process.nextTick(done, null, [loopback]);
  else process.nextTick(done, null, loopback.address, loopback.family);
};

dns.promises.lookup = function lookup(hostname, options) {
  if (!isLocalhostName(hostname)) return originalPromiseLookup.call(this, hostname, options);
  const all = typeof options === "object" && options !== null && options.all === true;
  return Promise.resolve(all ? [loopback] : loopback);
};

syncBuiltinESMExports();
