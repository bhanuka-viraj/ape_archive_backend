/**
 * Convert BigInt values to strings for JSON serialization
 * Elysia/JSON.stringify cannot handle BigInt, so we convert them to strings
 */
export function convertBigIntsToStrings(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === "bigint") {
    return obj.toString();
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => convertBigIntsToStrings(item));
  }

  if (typeof obj === "object") {
    const converted: any = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        converted[key] = convertBigIntsToStrings(obj[key]);
      }
    }
    return converted;
  }

  return obj;
}
