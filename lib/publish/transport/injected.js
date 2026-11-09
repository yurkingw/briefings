export const injectedTransport = Symbol("briefings.injectedTestTransport");

export function asTestTransport(transport) {
  if (!transport || typeof transport.fetchState !== "function" || typeof transport.publish !== "function") {
    throw new TypeError("test transport");
  }
  transport.mode = "injected-test";
  transport.production = false;
  transport[injectedTransport] = true;
  return transport;
}

export function isInjectedTestTransport(transport) {
  return Boolean(
    transport &&
      transport[injectedTransport] === true &&
      transport.mode === "injected-test" &&
      transport.production === false &&
      typeof transport.fetchState === "function" &&
      typeof transport.publish === "function",
  );
}
