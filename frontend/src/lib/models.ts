/**
 * The frontend's model catalogue, replacing the play server's /api/config and
 * /api/models. Metadata is collected from frontend/models/<id>/meta.json at
 * build time; the matching .onnx files are copied to dist/models/ by
 * vite-plugin-static-copy (see vite.config.ts).
 */

export interface ModelDefaults {
  mcts_n: number;
  mcts_c_puct: number;
  leaf_parallelism: number;
  virtual_loss: number;
}

export interface ModelEntry {
  id: string;
  label: string;
  isDefault: boolean;
  board_size: number;
  max_walls: number;
  max_steps: number;
  defaults: ModelDefaults;
}

function req<T>(id: string, obj: Record<string, unknown>, key: string, kind: "number" | "string"): T {
  const v = obj[key];
  if (typeof v !== kind) {
    throw new Error(
      `model "${id}": meta.json field "${key}" must be a ${kind}, got ${JSON.stringify(v)}`,
    );
  }
  return v as T;
}

/** Validate one meta.json body into a ModelEntry, or throw naming the model and field. */
export function parseMeta(id: string, raw: unknown): ModelEntry {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`model "${id}": meta.json must contain an object`);
  }
  const o = raw as Record<string, unknown>;
  const d = o.defaults;
  if (typeof d !== "object" || d === null) {
    throw new Error(`model "${id}": meta.json field "defaults" must be an object`);
  }
  const dd = d as Record<string, unknown>;
  return {
    id,
    label: req<string>(id, o, "label", "string"),
    isDefault: o.default === true,
    board_size: req<number>(id, o, "board_size", "number"),
    max_walls: req<number>(id, o, "max_walls", "number"),
    max_steps: req<number>(id, o, "max_steps", "number"),
    defaults: {
      mcts_n: req<number>(id, dd, "mcts_n", "number"),
      mcts_c_puct: req<number>(id, dd, "mcts_c_puct", "number"),
      leaf_parallelism: req<number>(id, dd, "leaf_parallelism", "number"),
      virtual_loss: req<number>(id, dd, "virtual_loss", "number"),
    },
  };
}

/** Turn a glob result keyed by meta.json path into id-sorted entries. */
export function buildEntries(globbed: Record<string, unknown>): ModelEntry[] {
  const entries = Object.entries(globbed).map(([path, raw]) => {
    const m = /([^/]+)\/meta\.json$/.exec(path);
    if (!m) throw new Error(`unexpected model metadata path: ${path}`);
    return parseMeta(m[1], raw);
  });
  if (entries.length === 0) {
    throw new Error("no models found under frontend/models/*/meta.json");
  }
  return entries.sort((a, b) => a.id.localeCompare(b.id));
}

/** The entry flagged `"default": true`, else the last by id (highest version). */
export function pickDefault(entries: ModelEntry[]): ModelEntry {
  const flagged = entries.filter((e) => e.isDefault);
  return flagged.length === 1 ? flagged[0] : entries[entries.length - 1];
}

/** Resolve `path` against `base`. Both models and ORT's runtime go through here. */
export function joinUrl(base: string, path: string): string {
  return new URL(path, base).href;
}

/**
 * The absolute URL this site is mounted at. Vite's base is "./", so this
 * works at the root, under a GitHub project page's /<repo>/ prefix, or under
 * a custom domain, with no configuration.
 */
export function siteBase(): string {
  return new URL(import.meta.env.BASE_URL, location.href).href;
}

export const MODELS: ModelEntry[] = buildEntries(
  import.meta.glob("../../models/*/meta.json", { eager: true, import: "default" }),
);

export function modelUrl(entry: ModelEntry): string {
  return joinUrl(siteBase(), `models/${entry.id}/model.onnx`);
}

export function ortBase(): string {
  return joinUrl(siteBase(), "ort/");
}
