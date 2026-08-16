import { st1Endpoint } from "./_lib/endpoint.js";
import { optionalDate, optionalString } from "./_lib/validation.js";
import { getProduct } from "./_lib/service.js";

export default st1Endpoint("getProduct", (prisma, input) => getProduct(prisma, {
  id: optionalString(input, "id"),
  sku: optionalString(input, "sku"),
  brand: optionalString(input, "brand"),
  date: optionalDate(input, "date"),
}));
