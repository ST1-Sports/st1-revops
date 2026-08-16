import { st1Endpoint } from "./_lib/endpoint.js";
import { optionalDate, optionalLimit, requireString } from "./_lib/validation.js";
import { getBrand } from "./_lib/service.js";

export default st1Endpoint("getBrand", (prisma, input) => getBrand(prisma, {
  name: requireString(input, "name"),
  date: optionalDate(input, "date"),
  limit: optionalLimit(input, 10, 30),
}));
