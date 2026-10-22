import { existsSync, globSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The oldest release of each supported Node.js line that carries every published
 * security fix. Raise it by hand whenever Node.js ships a security release; lines
 * not listed (20 and older, odd lines) get no security fixes at all.
 * Current floor: the 2026-10-21 security release (ten CVEs, including
 * CVE-2026-111497, remote code execution in the Brotli decoder).
 * @type {ReadonlyMap<number, readonly [number, number, number]>}
 */
export const securityFloor = new Map([
  [22, [22, 23, 4]],
  [24, [24, 22, 1]],
  [26, [26, 12, 1]],
]);

const exactVersion = /^v?(\d+)\.(\d+)\.(\d+)$/;

/** @param {string} version */
function parse(version) {
  const match = exactVersion.exec(version.trim());
  return match === null
    ? undefined
    : [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** @param {readonly number[]} version */
const format = (version) => version.join(".");

/** @param {readonly number[]} a @param {readonly number[]} b */
function isBelow([major, minor, patch], [floorMajor, floorMinor, floorPatch]) {
  if (major !== floorMajor) return major < floorMajor;
  if (minor !== floorMinor) return minor < floorMinor;
  return patch < floorPatch;
}

/**
 * Why a Node.js version is unsafe to run, or undefined when it has every security fix.
 * @param {string} version
 * @returns {string | undefined}
 */
export function insecurity(version) {
  const parsed = parse(version);
  if (parsed === undefined)
    return `"${version}" is not an exact version (x.y.z)`;
  const floor = securityFloor.get(parsed[0]);
  if (floor === undefined) {
    return `Node.js ${parsed[0]} gets no security fixes; use one of the lines ${[...securityFloor.keys()].join(", ")}`;
  }
  return isBelow(parsed, floor)
    ? `Node.js ${format(parsed)} is below the security floor ${format(floor)}`
    : undefined;
}

const nodeStage = /^\s*FROM\s+(?:--platform=\S+\s+)?node:(\S+)/i;

/** @param {{ path: string, text: string }} file */
function pinsIn({ path, text }) {
  if (path.endsWith(".nvmrc")) return [{ line: 1, version: text.trim() }];
  return text.split("\n").flatMap((line, index) => {
    const tag = nodeStage.exec(line)?.[1];
    // node:24.22.1-alpine pins 24.22.1; node:24-alpine pins nothing exact.
    return tag === undefined
      ? []
      : [{ line: index + 1, version: tag.split("-")[0] }];
  });
}

/**
 * Every Node.js version pinned in these files that is below the security floor.
 * @param {readonly { path: string, text: string }[]} files
 */
export function auditPins(files) {
  return files.flatMap((file) =>
    pinsIn(file).flatMap(({ line, version }) => {
      const message = insecurity(version);
      return message === undefined ? [] : [{ path: file.path, line, message }];
    }),
  );
}

/**
 * The files that pin this repository's Node.js: .nvmrc (CI) and every image's
 * Dockerfile. package.json's engines is a range and is not a pin.
 * @param {string} root
 */
export function readRepoPins(root) {
  const paths = [
    ...(existsSync(join(root, ".nvmrc")) ? [".nvmrc"] : []),
    ...globSync(["Dockerfile*", "apps/*/Dockerfile"], { cwd: root }).sort(),
  ];
  return paths.map((path) => ({
    path,
    text: readFileSync(join(root, path), "utf8"),
  }));
}
