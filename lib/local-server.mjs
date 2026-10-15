import fs from "node:fs/promises";
import path from "node:path";
export async function dashboardAsset(directory, relative) {
  const root = path.resolve(directory),
    file = path.resolve(root, relative),
    extension = path.extname(file).toLowerCase();
  if (
    !file.startsWith(root + path.sep) ||
    ![".html", ".jpg", ".png", ".svg"].includes(extension)
  )
    throw Error("Not found");
  const [realRoot, realFile] = await Promise.all([
    fs.realpath(root),
    fs.realpath(file),
  ]);
  if (!realFile.startsWith(realRoot + path.sep)) throw Error("Not found");
  return {
    bytes: await fs.readFile(realFile),
    contentType: {
      ".html": "text/html; charset=utf-8",
      ".jpg": "image/jpeg",
      ".png": "image/png",
      ".svg": "image/svg+xml",
    }[extension],
  };
}
