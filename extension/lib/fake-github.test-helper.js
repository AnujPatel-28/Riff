// In-memory stand-in for the slice of the GitHub REST API that Riff uses.
// Lets tests check the real outcome (files on the branch, one commit per
// idea) instead of asserting on request shapes.

import { base64ToText, textToBase64 } from "./github.js";

export function fakeGitHub({ owner = "ana", repo = "inspiration", empty = true, push = true } = {}) {
  const blobs = new Map(); // sha -> base64
  const trees = new Map(); // sha -> Map(path -> blobSha)
  const commits = new Map(); // sha -> { tree, parents, message }
  let head = null;
  let counter = 0;
  const id = (prefix) => `${prefix}${(counter += 1).toString(16).padStart(6, "0")}`;
  const calls = [];
  let interfere = null; // a function that moves the branch once, to test retries

  const filesAt = (commitSha) => (commitSha ? trees.get(commits.get(commitSha).tree) : new Map());

  function json(status, body) {
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  function commitFiles(files, message) {
    const tree = new Map(filesAt(head));
    for (const [path, base64] of files) {
      const blob = id("b");
      blobs.set(blob, base64);
      tree.set(path, blob);
    }
    const treeSha = id("t");
    trees.set(treeSha, tree);
    const sha = id("c");
    commits.set(sha, { tree: treeSha, parents: head ? [head] : [], message });
    head = sha;
    return sha;
  }

  if (!empty) commitFiles([["README.md", textToBase64("# Inspiration\n")]], "init");

  async function handler(url, init = {}) {
    const method = init.method || "GET";
    const { pathname, searchParams } = new URL(url);
    const prefix = `/repos/${owner}/${repo}`;
    calls.push(`${method} ${pathname.slice(prefix.length) || "/"}`);
    if (!pathname.startsWith(prefix)) return json(404, { message: "Not Found" });
    if (init.headers?.Authorization !== "Bearer good-token") return json(401, { message: "Bad credentials" });
    const route = pathname.slice(prefix.length);
    const body = init.body ? JSON.parse(init.body) : undefined;

    if (method === "GET" && route === "") {
      return json(200, { default_branch: "main", private: false, html_url: `https://github.com/${owner}/${repo}`, permissions: { push } });
    }
    if (method === "GET" && route === "/git/ref/heads/main") {
      return head ? json(200, { object: { sha: head } }) : json(409, { message: "Git Repository is empty." });
    }
    if (method === "GET" && route.startsWith("/contents/")) {
      const path = decodeURIComponent(route.slice("/contents/".length));
      if (searchParams.get("ref") !== "main") return json(404, { message: "No ref" });
      const blob = filesAt(head).get(path);
      return blob ? json(200, { content: blobs.get(blob), encoding: "base64" }) : json(404, { message: "Not Found" });
    }
    if (method === "PUT" && route.startsWith("/contents/")) {
      const path = decodeURIComponent(route.slice("/contents/".length));
      commitFiles([[path, body.content]], body.message);
      return json(201, { commit: { sha: head } });
    }
    if (method === "GET" && route.startsWith("/git/commits/")) {
      const commit = commits.get(route.slice("/git/commits/".length));
      return commit ? json(200, { tree: { sha: commit.tree } }) : json(404, { message: "Not Found" });
    }
    if (method === "POST" && route === "/git/blobs") {
      const sha = id("b");
      blobs.set(sha, body.encoding === "base64" ? body.content : textToBase64(body.content));
      return json(201, { sha });
    }
    if (method === "POST" && route === "/git/trees") {
      const tree = new Map(trees.get(body.base_tree));
      for (const entry of body.tree) tree.set(entry.path, entry.sha);
      const sha = id("t");
      trees.set(sha, tree);
      return json(201, { sha });
    }
    if (method === "POST" && route === "/git/commits") {
      const sha = id("c");
      commits.set(sha, { tree: body.tree, parents: body.parents, message: body.message });
      return json(201, { sha });
    }
    if (method === "PATCH" && route === "/git/refs/heads/main") {
      if (interfere) {
        const run = interfere;
        interfere = null;
        run();
      }
      const commit = commits.get(body.sha);
      if (!commit || commit.parents[0] !== head) return json(422, { message: "Update is not a fast forward" });
      head = body.sha;
      return json(200, { object: { sha: head } });
    }
    return json(404, { message: `No fake for ${method} ${route}` });
  }

  return {
    fetch: handler,
    calls,
    /** Text of a file on the branch, or undefined. */
    read(path) {
      const blob = filesAt(head).get(path);
      return blob ? base64ToText(blobs.get(blob)) : undefined;
    },
    readBase64(path) {
      const blob = filesAt(head).get(path);
      return blob ? blobs.get(blob) : undefined;
    },
    paths() {
      return [...filesAt(head).keys()].sort();
    },
    commitCount() {
      let n = 0;
      for (let sha = head; sha; sha = commits.get(sha).parents[0]) n += 1;
      return n;
    },
    lastMessage() {
      return head ? commits.get(head).message : undefined;
    },
    /** Someone else pushes right before our next ref update. */
    pushBeforeNextUpdate(path, text) {
      interfere = () => commitFiles([[path, textToBase64(text)]], "someone else");
    },
  };
}
