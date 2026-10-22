export const LIMITS = {
  maxZipBytes: 20 * 1024 * 1024, // 20 MiB
  maxEntries: 2000, // including folders
  maxUncompressedBytes: 100 * 1024 * 1024, // 100 MiB
} as const

export type Limits = typeof LIMITS
