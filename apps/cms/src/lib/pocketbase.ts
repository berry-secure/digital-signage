import PocketBase from "pocketbase";

export const pocketbaseUrl =
  import.meta.env.VITE_POCKETBASE_URL?.trim() || "https://pb.berry-secure.pl";

export function createPocketBaseClient() {
  const client = new PocketBase(pocketbaseUrl);
  client.autoCancellation(false);
  return client;
}
