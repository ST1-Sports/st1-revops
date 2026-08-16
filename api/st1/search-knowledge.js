import { st1Endpoint } from "./_lib/endpoint.js";
import { optionalDate, optionalLimit, optionalString, requireString } from "./_lib/validation.js";
import { searchKnowledge } from "./_lib/service.js";

export default st1Endpoint("searchKnowledge", (prisma, input) => searchKnowledge(prisma, {
  query: requireString(input, "query"),
  category: optionalString(input, "category"),
  date: optionalDate(input, "date"),
  limit: optionalLimit(input, 20, 50),
}));
