import PocketBase from "pocketbase";

export const defaultPocketBaseUrl =
  import.meta.env.VITE_DEFAULT_POCKETBASE_URL?.trim() || "https://pb.berry-secure.pl";

export function createPocketBaseClient(url: string) {
  const client = new PocketBase(url);
  client.autoCancellation(false);
  return client;
}
