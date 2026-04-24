import { createApp, resolveServerConfig } from "./app.js";

const config = resolveServerConfig();
const app = await createApp(config);

app.listen(config.port, () => {
  console.log(`Digital Signage server listening on http://0.0.0.0:${config.port}`);
});
