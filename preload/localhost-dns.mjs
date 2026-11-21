import dns from "node:dns";
import { syncBuiltinESMExports } from "node:module";

const loopback = { address: "127.0.0.1", family: 4 };
const isLocalhostName = (hostname) => typeof hostname === "string" && /\.localhost\.?$/i.test(hostname);
const wantsAll = (options) => Reflect.get(Object(options), "all") === true;
const originalLookup = dns.lookup;
const originalPromiseLookup = dns.promises.lookup;

dns.lookup = function lookup(hostname, options, callback) {
  if (!isLocalhostName(hostname)) {
    originalLookup.call(this, hostname, options, callback);
    return;
  }
  const done = typeof options === "function" ? options : callback;
  if (wantsAll(options)) process.nextTick(done, null, [loopback]);
  else process.nextTick(done, null, loopback.address, loopback.family);
};

dns.promises.lookup = async function lookup(hostname, options) {
  if (!isLocalhostName(hostname)) return originalPromiseLookup.call(this, hostname, options);
  return wantsAll(options) ? [loopback] : loopback;
};

syncBuiltinESMExports();
