import { isRecord } from "../src/detect/files.ts";

export const parseRecord = (text: string): Record<string, unknown> => {
  const value = JSON.parse(text) as unknown;
  if (!isRecord(value)) throw new TypeError(`expected a JSON object: ${text}`);
  return value;
};
