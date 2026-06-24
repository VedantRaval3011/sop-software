/** Shared MongoDB driver options for Atlas on Windows (IPv4 + longer handshake). */
export const MONGO_CONNECT_OPTIONS = {
  serverSelectionTimeoutMS: 60_000,
  connectTimeoutMS: 30_000,
  socketTimeoutMS: 45_000,
  family: 4,
  retryWrites: true,
  retryReads: true,
};
