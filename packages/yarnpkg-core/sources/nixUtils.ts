import {execUtils}    from '@yarnpkg/core';
import {PortablePath} from '@yarnpkg/fslib';
import {createHash}   from 'crypto';
import path           from 'node:path';

export const nixDebug = (...args: Array<unknown>) => {
  if (process.env.YARNNIX_DEBUG) {
    console.log(...args);
  }
};
const charset = `0123456789abcdfghijklmnpqrsvwxyz`;

const nixStorePathNameRegex = new RegExp(`^/nix/store/[${charset}]{32}-(.*)$`);

export const getNameFromNixStorePath = (path: string | PortablePath) => {
  const match = path.match(nixStorePathNameRegex);

  if (match === null)
    throw new Error(`not a valid /nix/store path: ${path}`);

  return match[1];
};
/**
 * Short-hand for simple hash computation.
 */
export const computeHash = (algorithm: string, data: string | Buffer) =>
  createHash(algorithm).update(data).digest();

/**
 * Nix-compatible hash compression.
 */
export const compressHash = (hash: Buffer, size: number) => {
  const result = Buffer.alloc(size);
  for (let idx = 0; idx < hash.length; idx++)
    result[idx % size]! ^= hash[idx]!;


  return result;
};

/**
 * Nix-compatible base32 encoding.
 *
 * This is probably a super inefficient implementation, but we only process
 * small inputs. (20 bytes)
 */
export const encodeBase32 = (buf: Buffer) => {
  let result = ``;
  let bits = [...buf]
    .reverse()
    .map(n => n.toString(2).padStart(8, `0`))
    .join(``);
  while (bits) {
    result += charset[parseInt(bits.slice(0, 5), 2)];
    bits = bits.slice(5);
  }
  return result;
};

/**
 * Compute the Nix store path for a fixed-output derivation.
 */
export const computeFixedOutputStorePath = (
  name: string,
  hashAlgorithm: string,
  hash: Buffer,
  storePath = `/nix/store`,
) => {
  const hashHex = hash.toString(`hex`);

  const innerStr = `fixed:out:${hashAlgorithm}:${hashHex}:`;
  const innerHash = computeHash(`sha256`, innerStr);
  const innerHashHex = innerHash.toString(`hex`);

  const outerStr = `output:out:sha256:${innerHashHex}:${storePath}:${name}`;
  const outerHash = computeHash(`sha256`, outerStr);
  const outerHash32 = encodeBase32(compressHash(outerHash, 20));

  return path.join(storePath, `${outerHash32}-${name}`);
};

/**
 * Creates a valid derivation name from a potentially invalid one.
 *
 * Matches lib.strings.sanitizeDerivationName in Nixpkgs.
 */
export const sanitizeDerivationName = (name: string) =>
  name
    .replace(/^\.+/, ``)
    .replace(/[^a-zA-Z0-9+._?=-]+/g, `_`)
    .slice(0, 207) || `unknown`;

export const getNixStorePath = (filePath: PortablePath | string, checksum: string) => {
  const fileName = path.parse(filePath).base;
  const name = sanitizeDerivationName(fileName);
  const hash = Buffer.from(checksum, `hex`);
  const nixStorePath = computeFixedOutputStorePath(name, `sha512`, hash);
  nixDebug(`getNixStorePath`, {filePath, checksum, nixStorePath});
  return nixStorePath;
};

export const addToNixStore = async ({
  filePath,
  targetfileName,
  checksum,
  cwd,
}: {
  targetfileName: string;
  filePath: PortablePath;
  checksum: string;
  cwd: PortablePath;
}) => {
  const expectedPath = getNixStorePath(targetfileName, checksum);

  nixDebug(`addToNixStore`, {
    filePath,
    targetfileName,
    // storePath,
    // checksum,
  });

  const a = await execUtils.execvp(
    `nix`,
    [
      `store`,
      `add`,
      `--hash-algo`,
      `sha512`,
      `--mode`,
      `flat`,
      filePath,
      `--name`,
      targetfileName,
    ],
    {
      cwd,
      strict: true,
    },
  );

  nixDebug(a);
  if (a.code != 0)
    throw new Error(`nix store add exited with error: ${a.stderr}`);

  const createdNixStorePath = a.stdout.split(`\n`)[0];

  if (createdNixStorePath !== expectedPath)
    throw new Error(`createdNixStorePath (${createdNixStorePath}) !== expectedPath (${expectedPath})`);

  return createdNixStorePath;
};
