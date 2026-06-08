import mongoose from "mongoose";
import { ensureDefaultAdmin } from "@/lib/ensure-admin";
import { validateEnv } from "@/lib/validateEnv";

const MONGODB_URI = process.env.MONGODB_URI;

interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
  uri?: string;
}

declare global {
  // eslint-disable-next-line no-var
  var mongooseCache: MongooseCache | undefined;
}

const cached: MongooseCache = global.mongooseCache ?? {
  conn: null,
  promise: null,
};

if (!global.mongooseCache) {
  global.mongooseCache = cached;
}

export async function connectDB() {
  validateEnv();
  if (!MONGODB_URI) {
    throw new Error("Please define MONGODB_URI in .env.local");
  }

  // Reconnect if URI changed (e.g. after .env.local edit)
  if (cached.conn && cached.uri !== MONGODB_URI) {
    await mongoose.disconnect();
    cached.conn = null;
    cached.promise = null;
  }

  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    cached.uri = MONGODB_URI;
    cached.promise = mongoose.connect(MONGODB_URI, {
      bufferCommands: false,
    });
  }

  cached.conn = await cached.promise;
  await ensureDefaultAdmin();
  return cached.conn;
}
