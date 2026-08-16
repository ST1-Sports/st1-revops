function typeOf(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

function matchesType(value, expected) {
  if (Array.isArray(expected)) return expected.some(type => matchesType(value, type));
  if (expected === 'integer') return Number.isInteger(value);
  if (expected === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (expected === 'array') return Array.isArray(value);
  if (expected === 'null') return value === null;
  return typeof value === expected;
}

function validateAnyOf(schema, value, path) {
  if (!Array.isArray(schema.anyOf) || schema.anyOf.length === 0) return [];
  const branchErrors = schema.anyOf.map(branch => validateSchema(branch, value, path));
  if (branchErrors.some(errors => errors.length === 0)) return [];
  return [`${path} must match at least one allowed input shape`];
}

export function validateSchema(schema, value, path = '$') {
  const errors = [];
  if (!schema || typeof schema !== 'object') return errors;

  if (schema.anyOf) {
    errors.push(...validateAnyOf(schema, value, path));
  }

  if (schema.type && !matchesType(value, schema.type)) {
    errors.push(`${path} must be ${Array.isArray(schema.type) ? schema.type.join(' or ') : schema.type}; got ${typeOf(value)}`);
    return errors;
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path} must be one of: ${schema.enum.join(', ')}`);
  }

  if (typeof value === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) {
      errors.push(`${path} must be at least ${schema.minLength} characters`);
    }
    if (schema.maxLength != null && value.length > schema.maxLength) {
      errors.push(`${path} must be at most ${schema.maxLength} characters`);
    }
    if (schema.pattern && !(new RegExp(schema.pattern).test(value))) {
      errors.push(`${path} must match pattern ${schema.pattern}`);
    }
  }

  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) {
      errors.push(`${path} must be at least ${schema.minimum}`);
    }
    if (schema.maximum != null && value > schema.maximum) {
      errors.push(`${path} must be at most ${schema.maximum}`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) {
      errors.push(`${path} must include at least ${schema.minItems} item(s)`);
    }
    if (schema.maxItems != null && value.length > schema.maxItems) {
      errors.push(`${path} must include at most ${schema.maxItems} item(s)`);
    }
    if (schema.uniqueItems) {
      const seen = new Set(value.map(item => JSON.stringify(item)));
      if (seen.size !== value.length) errors.push(`${path} must not contain duplicate items`);
    }
    if (schema.items) {
      value.forEach((item, idx) => {
        errors.push(...validateSchema(schema.items, item, `${path}[${idx}]`));
      });
    }
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const properties = schema.properties || {};
    for (const required of schema.required || []) {
      if (!(required in value)) errors.push(`${path}.${required} is required`);
    }

    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) errors.push(`${path}.${key} is not allowed`);
      }
    }

    for (const [key, childSchema] of Object.entries(properties)) {
      if (key in value) {
        errors.push(...validateSchema(childSchema, value[key], `${path}.${key}`));
      }
    }
  }

  return errors;
}

export function validateToolInput(tool, input) {
  const errors = validateSchema(tool.input_schema, input ?? {});
  if (errors.length) {
    return {
      ok: false,
      error: {
        code: 'invalid_input',
        message: 'Tool input did not match the declared schema',
        details: errors,
      },
    };
  }
  return { ok: true };
}

export function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}
