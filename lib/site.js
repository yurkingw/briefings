export const site = {
  name: "Briefings",
  baseUrl: "https://yurkingw.github.io/briefings",
  pathPrefix: "/briefings/",
  origin: "https://yurkingw.github.io",
};

export function absoluteUrl(url, config = site) {
  const prefix = config.pathPrefix.endsWith("/")
    ? config.pathPrefix
    : `${config.pathPrefix}/`;
  const base = config.baseUrl.replace(/\/$/, "");

  if (!url || url === "/") {
    return `${base}/`;
  }

  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  let path = url.startsWith("/") ? url : `/${url}`;
  const prefixRoot = prefix.slice(0, -1);
  if (path !== prefixRoot && !path.startsWith(prefix)) {
    path = `${prefixRoot}${path}`;
  }

  const doubled = `${prefixRoot}${prefixRoot}`;
  while (path.startsWith(doubled)) {
    path = `${prefixRoot}${path.slice(doubled.length)}`;
  }

  return `${config.origin}${path}`;
}
