// Minimal GitHub client for the inspiration repo: read a file, and write a
// set of files as one commit through the Git Data API. Uses the person's own
// fine-grained token; nothing goes anywhere but api.github.com.

const API = "https://api.github.com";

export class GitHubError extends Error {
  /** @param {string} message @param {number} status @param {string} [hint] */
  constructor(message, status, hint) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
    this.hint = hint;
  }
}

/** `owner/name`, a github.com URL, or `owner/name.git` → { owner, repo } */
export function parseRepo(input) {
  const text = String(input || "").trim().replace(/\.git$/, "").replace(/\/+$/, "");
  const match = text.match(/^(?:https?:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+)$/i);
  return match ? { owner: match[1], repo: match[2] } : null;
}

/** UTF-8 safe base64 for text, chunked so large snippets do not overflow the stack. */
export function textToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function base64ToText(base64) {
  const binary = atob(base64.replace(/\s+/g, ""));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

const HINTS = {
  401: "The token was rejected. Create a new fine-grained token and paste it again.",
  403: "The token can't write to this repo. Give it Contents: Read and write on the inspiration repo.",
  404: "Repo not found. Check the name, and that the token can access that repo.",
};

export class InspirationRepo {
  /**
   * @param {{ owner: string, repo: string, token: string, fetch?: typeof fetch }} options
   */
  constructor({ owner, repo, token, fetch: fetchImpl }) {
    this.owner = owner;
    this.repo = repo;
    this.token = token;
    this.fetch = fetchImpl || globalThis.fetch.bind(globalThis);
    this.branch = null;
  }

  get webUrl() {
    return `https://github.com/${this.owner}/${this.repo}`;
  }

  async request(method, path, body) {
    let response;
    try {
      response = await this.fetch(`${API}/repos/${this.owner}/${this.repo}${path}`, {
        method,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${this.token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new GitHubError("Unable to reach GitHub. Check your connection and try again.", 0);
    }
    if (response.status === 204) return null;
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = data?.message ? `GitHub said: ${data.message}` : `GitHub answered ${response.status}`;
      throw new GitHubError(detail, response.status, HINTS[response.status]);
    }
    return data;
  }

  /** Checks access and learns the default branch. */
  async connect() {
    const info = await this.request("GET", "");
    if (info?.permissions && info.permissions.push === false) {
      throw new GitHubError("This token can read the repo but not write to it.", 403, HINTS[403]);
    }
    this.branch = info.default_branch || "main";
    return { branch: this.branch, private: Boolean(info.private), url: info.html_url };
  }

  async ensureBranch() {
    if (!this.branch) await this.connect();
    return this.branch;
  }

  /** @returns {Promise<string | null>} file text, or null when it does not exist */
  async readText(path) {
    const branch = await this.ensureBranch();
    try {
      const file = await this.request("GET", `/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`);
      return file?.content ? base64ToText(file.content) : "";
    } catch (error) {
      if (error instanceof GitHubError && (error.status === 404 || error.status === 409)) return null;
      throw error;
    }
  }

  /** Head commit of the branch, or null for a repo with no commits yet. */
  async head() {
    const branch = await this.ensureBranch();
    try {
      const ref = await this.request("GET", `/git/ref/heads/${encodeURIComponent(branch)}`);
      return ref.object.sha;
    } catch (error) {
      if (error instanceof GitHubError && (error.status === 404 || error.status === 409)) return null;
      throw error;
    }
  }

  /**
   * Writes files as one commit. `build` receives a reader and returns the
   * files, so a retry after a concurrent push rebuilds them (for example a
   * fresh index.json) instead of overwriting someone else's change.
   *
   * @param {(read: (path: string) => Promise<string | null>) => Promise<Array<{ path: string, text?: string, base64?: string }>>} build
   * @param {string} message
   */
  async commit(build, message) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let parent = await this.head();
      if (parent === null) {
        // The Git Data API refuses to work on an empty repository, so the
        // first file goes through the Contents API, which creates the branch.
        await this.request("PUT", `/contents/README.md`, {
          message: "Start the inspiration library",
          content: textToBase64("# Inspiration\n\nCaptured with Riff. See INDEX.md.\n"),
          branch: this.branch,
        });
        parent = await this.head();
      }
      const files = await build((path) => this.readText(path));
      const base = await this.request("GET", `/git/commits/${parent}`);

      const tree = [];
      for (const file of files) {
        const blob = await this.request("POST", "/git/blobs", file.base64 !== undefined
          ? { content: file.base64, encoding: "base64" }
          : { content: file.text ?? "", encoding: "utf-8" });
        tree.push({ path: file.path, mode: "100644", type: "blob", sha: blob.sha });
      }
      const newTree = await this.request("POST", "/git/trees", { base_tree: base.tree.sha, tree });
      const commit = await this.request("POST", "/git/commits", { message, tree: newTree.sha, parents: [parent] });
      try {
        await this.request("PATCH", `/git/refs/heads/${encodeURIComponent(this.branch)}`, { sha: commit.sha });
        return { sha: commit.sha, url: `${this.webUrl}/commit/${commit.sha}` };
      } catch (error) {
        // 422: the branch moved while we were writing. Rebuild once on top of it.
        if (!(error instanceof GitHubError && error.status === 422) || attempt === 1) throw error;
      }
    }
    throw new GitHubError("The repo kept changing while saving. Try again.", 409);
  }

  fileUrl(path) {
    return `${this.webUrl}/blob/${this.branch || "main"}/${encodePath(path)}`;
  }
}

function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}
