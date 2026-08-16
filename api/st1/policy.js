import { st1Endpoint } from "./_lib/endpoint.js";
import { optionalDate, optionalString } from "./_lib/validation.js";
import { getPolicy } from "./_lib/service.js";

export default st1Endpoint("getPolicy", (prisma, input) => getPolicy(prisma, {
  title: optionalString(input, "title"),
  date: optionalDate(input, "date"),
}));
