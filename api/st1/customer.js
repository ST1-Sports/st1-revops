import { st1Endpoint } from "./_lib/endpoint.js";
import { optionalDate, optionalLimit, requireString } from "./_lib/validation.js";
import { getCustomer } from "./_lib/service.js";

export default st1Endpoint("getCustomer", (prisma, input) => getCustomer(prisma, {
  name: requireString(input, "name"),
  date: optionalDate(input, "date"),
  limit: optionalLimit(input, 10, 30),
}));
