import { st1Endpoint } from "./_lib/endpoint.js";
import { optionalDate, requireString } from "./_lib/validation.js";
import { getDocument } from "./_lib/service.js";

export default st1Endpoint("getDocument", (prisma, input) => getDocument(prisma, {
  id: requireString(input, "id"),
  date: optionalDate(input, "date"),
  includeContent: input.includeContent !== "false",
}));
