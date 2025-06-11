import fetch from "node-fetch";
import "dotenv/config";
const { CLOUD_URL, CLOUD_PASSWORD } = process.env;
const log = require("pino")();

export async function cloud(path: string, data: any) {
  log.info("cloud %s %o", path, data);
  const res = await fetch(`${CLOUD_URL}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Password": CLOUD_PASSWORD!
    },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error(`Cloud error ${res.status}`);
  return res.json();
}