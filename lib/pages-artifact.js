export const PAGES_ARTIFACT_NAME = "github-pages";

export function selectPagesArtifact(artifacts, name = PAGES_ARTIFACT_NAME) {
  const matches = (artifacts || []).filter((item) => item && item.name === name);
  if (matches.length === 0) {
    throw new Error(
      `No artifacts named "${name}" were found for this workflow run. Ensure artifacts are uploaded with actions/upload-artifact@v4 or later.`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Multiple artifacts named "${name}" were unexpectedly found for this workflow run. Artifact count is ${matches.length}.`,
    );
  }
  return matches[0];
}

// upload-artifact@v4.6.2 overwrite deletes one existing artifact of that name
// (the highest id) and then uploads another. It does not clear every copy.
export function artifactsAfterUpload(existing, {name = PAGES_ARTIFACT_NAME, overwrite, uploaded}) {
  const list = (existing || []).map((item) => ({...item}));
  if (overwrite) {
    let newest = -1;
    let newestId = -1;
    list.forEach((item, index) => {
      if (item.name !== name) return;
      const id = Number(item.id) || 0;
      if (id >= newestId) {
        newestId = id;
        newest = index;
      }
    });
    if (newest >= 0) list.splice(newest, 1);
  }
  list.push({name, id: uploaded.id, digest: uploaded.digest});
  return list;
}
