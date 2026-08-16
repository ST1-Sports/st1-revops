import { st1Endpoint } from "./_lib/endpoint.js";
import { optionalDate, optionalString, requireString } from "./_lib/validation.js";
import { getPricing } from "./_lib/service.js";

export default st1Endpoint("getPricing", (prisma, input) => getPricing(prisma, {
  sku: requireString(input, "sku"),
  brand: optionalString(input, "brand"),
  customerId: optionalString(input, "customerId"),
  programId: optionalString(input, "programId"),
  date: optionalDate(input, "date"),
}));
