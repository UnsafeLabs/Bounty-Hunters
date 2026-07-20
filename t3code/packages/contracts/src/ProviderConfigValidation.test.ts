import {
  ProviderConfigError,
  validateProviderConfig,
  validateApiKey,
  validateEndpoint,
} from "./ProviderConfigValidation.ts";

function assert(c: unknown, m: string): asserts c {
  if (!c) throw new Error(m);
}

// valid
const ok = validateProviderConfig({
  apiKey: "sk-live-1234567890",
  endpoint: "https://api.example.com/v1",
});
assert(ok._tag === "Right", "valid config");

// empty api key
assert(validateApiKey("") instanceof ProviderConfigError, "empty key");
assert(validateApiKey("short") instanceof ProviderConfigError, "short key");

// http rejected
const httpErr = validateEndpoint("http://api.example.com");
assert(httpErr instanceof ProviderConfigError, "http");
assert(/HTTPS/i.test(httpErr!.expected) || /HTTPS/i.test(httpErr!.message), "https msg");

// malformed
assert(validateEndpoint("not a url") instanceof ProviderConfigError, "malformed");

// multiple errors at once
const multi = validateProviderConfig({
  apiKey: "",
  endpoint: "http://insecure.example",
});
assert(multi._tag === "Left", "left");
assert(multi._tag === "Left" && multi.left.length >= 2, `multi errors got ${multi._tag === "Left" ? multi.left.length : 0}`);
assert(multi._tag === "Left" && multi.left.every((e) => e instanceof ProviderConfigError), "typed");
assert(multi._tag === "Left" && multi.left[0]!.field && multi.left[0]!.expected, "fields");

console.log("ProviderConfigValidation tests: all passed");
