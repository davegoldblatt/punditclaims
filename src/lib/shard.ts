// Which evidence shard a claim's details live in. The same function runs at
// build time and in the browser, so both agree without a lookup table.
export const SHARDS = 64;
export function shardOf(id: string): number {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = ((h * 33) ^ id.charCodeAt(i)) >>> 0;
  return h % SHARDS;
}
