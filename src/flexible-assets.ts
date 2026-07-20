/**
 * Tenant-specific flexible-asset tools.
 *
 * IT Glue stores flexible-asset values in the `traits` object using the
 * field's `name-key`.  This module keeps the tenant's schema in one place and
 * exposes small, typed tools on top of the generic JSON:API resource.
 */

export interface FlexibleAssetClient {
  request<T = Record<string, unknown>>(
    path: string,
    params?: Record<string, unknown>
  ): Promise<{ data: T[]; meta: unknown }>;
  get<T = Record<string, unknown>>(
    path: string,
    params?: Record<string, unknown>
  ): Promise<T>;
  post<T = Record<string, unknown>>(
    path: string,
    body: Record<string, unknown>
  ): Promise<T>;
  patch<T = Record<string, unknown>>(
    path: string,
    body?: Record<string, unknown>
  ): Promise<T>;
}

export type FlexibleFieldKind =
  | "Header"
  | "Text"
  | "Textbox"
  | "Select"
  | "Checkbox"
  | "Number"
  | "Tag"
  | "Upload"
  | "Password";

export interface FlexibleAssetField {
  id: string;
  name: string;
  nameKey: string;
  kind: FlexibleFieldKind;
  required: boolean;
  useForTitle: boolean;
  tagType?: string | null;
  options?: string[];
}

export interface FlexibleAssetSchema {
  typeId: number;
  name: string;
  fields: readonly FlexibleAssetField[];
  requiredInputNames: readonly string[];
  identityInputNames: readonly string[];
  titleInputNames: readonly string[];
}

type JsonRecord = Record<string, unknown>;
type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

const field = (
  id: string,
  name: string,
  nameKey: string,
  kind: FlexibleFieldKind,
  options?: string[],
  tagType?: string | null,
  required = false,
  useForTitle = false
): FlexibleAssetField => ({
  id,
  name,
  nameKey,
  kind,
  required,
  useForTitle,
  options,
  tagType,
});

const schemas: readonly FlexibleAssetSchema[] = [
  {
    typeId: 379697,
    name: "Printers and Scanners",
    requiredInputNames: ["device_name", "location_ids"],
    identityInputNames: ["device_name", "location_ids"],
    titleInputNames: ["device_name"],
    fields: [
      field("5914636", "Device Name", "device-name", "Text", undefined, null, true, true),
      field("5914637", "Model", "model", "Text"),
      field("5914638", "Serial Number", "serial-number", "Text"),
      field("6164925", "Connectivity Type", "connectivity-type", "Select", ["Wired", "Wireless", "USB", "Other"]),
      field("5914639", "IP Address/Hostname", "ip-address-hostname", "Text"),
      field("5914640", "DHCP", "dhcp", "Checkbox"),
      field("5914641", "MAC Address", "mac-address", "Text"),
      field("6164926", "Location", "location", "Tag", undefined, "Locations", true),
      field("5914642", "Location Details", "location-details", "Text"),
      field("5914644", "Driver link", "driver-link", "Text"),
      field("5914646", "Admin Credentials", "admin-credentials", "Tag", undefined, "Passwords"),
      field("5914647", "User Authentication Method", "user-authentication-method", "Select", ["User Box & PIN", "User Box", "No User Box - No Restrictions", "Badge Scanning"]),
      field("5914649", "Printer Management Company", "printer-management-company", "Tag", undefined, "FlexibleAssetType: 54464"),
      field("6119723", "Notes", "notes", "Textbox"),
    ],
  },
  {
    typeId: 54463,
    name: "Applications",
    requiredInputNames: ["name"],
    identityInputNames: ["name"],
    titleInputNames: ["name"],
    fields: [
      field("582802", "Name", "name", "Text", undefined, null, true, true),
      field("582803", "Category", "category", "Select", ["CRM", "Database", "ERP", "Finance", "Marketing", "Sales", "Other"]),
      field("582804", "Version", "version", "Text", undefined, null, false, true),
      field("582805", "Importance", "importance", "Select", ["Critical", "High", "Medium", "Low"]),
      field("582806", "Business Impact", "business-impact", "Text"),
      field("582807", "Application Champion", "application-champion", "Tag", undefined, "Contacts"),
      field("582808", "Application Server(s)", "application-server-s", "Tag", undefined, "Configurations"),
      field("582810", "Vendor", "vendor", "Tag", undefined, "FlexibleAssetType: 54464"),
      field("582811", "Licensing Information", "licensing-information", "Tag", undefined, "FlexibleAssetType: 53905"),
      field("1662603", "Notes", "notes", "Textbox"),
    ],
  },
  {
    typeId: 54455,
    name: "Internet/WAN",
    requiredInputNames: ["provider", "link_type", "location_ids"],
    identityInputNames: ["provider", "link_type", "location_ids"],
    titleInputNames: ["provider", "link_type"],
    fields: [
      field("582646", "Provider", "provider", "Text", undefined, null, true, true),
      field("582647", "Link Type", "link-type", "Select", ["Fiber", "ADSL", "Cable", "Ethernet", "MPLS", "VPN", "Other"], null, true, true),
      field("582648", "Location(s)", "location-s", "Tag", undefined, "Locations", true),
      field("582649", "SLA", "sla", "Select", ["4-Hour", "24-Hour", "Best Effort", "Other"]),
      field("596608", "Vendor Support Number", "vendor-support-number", "Tag", undefined, "Contacts"),
      field("582650", "Account Number", "account-number", "Text"),
      field("582651", "Login", "login", "Tag", undefined, "Passwords"),
      field("582652", "Monthly Fee", "monthly-fee", "Number"),
      field("582654", "Upload Speed (Mbps)", "upload-speed-mbps", "Number"),
      field("582655", "Download Speed (Mbps)", "download-speed-mbps", "Number"),
      field("582656", "Router/Firewall", "router-firewall", "Tag", undefined, "Configurations"),
      field("582657", "IP Address(es)", "ip-address-es", "Textbox"),
      field("966674", "Notes", "notes", "Textbox"),
    ],
  },
  {
    typeId: 53763,
    name: "LAN",
    requiredInputNames: ["name", "location_ids"],
    identityInputNames: ["name", "location_ids"],
    titleInputNames: ["name"],
    fields: [
      field("575386", "Name", "name", "Text", undefined, null, true, true),
      field("575387", "Subnet", "subnet", "Text", undefined, null, false, true),
      field("575388", "Location", "location", "Tag", undefined, "Locations", true),
      field("575389", "Firewall", "firewall", "Tag", undefined, "Configurations"),
      field("575390", "Switch(es)", "switch-es", "Tag", undefined, "Configurations"),
      field("575391", "Servers", "servers", "Tag", undefined, "Configurations"),
      field("575392", "Network Diagram", "network-diagram", "Textbox"),
      field("575395", "DHCP Scope", "dhcp-scope", "Text"),
      field("575396", "DHCP Server", "dhcp-server", "Tag", undefined, "Configurations"),
      field("575397", "VLAN(s)", "vlan-s", "Text"),
      field("643694", "Notes", "notes", "Textbox"),
    ],
  },
  {
    typeId: 53878,
    name: "Wireless",
    requiredInputNames: ["network_name", "ssid", "encryption_type"],
    identityInputNames: ["ssid", "physical_location_ids"],
    titleInputNames: ["network_name", "ssid"],
    fields: [
      field("576604", "Network Name", "network-name", "Text", undefined, null, true, true),
      field("576605", "Physical Location", "physical-location", "Tag", undefined, "Locations"),
      field("576606", "SSID", "ssid", "Text", undefined, null, true),
      field("576607", "Encryption Type", "encryption-type", "Select", ["None", "WEP", "WPA", "WPA2-Personal", "WPA2-Enterprise", "WPA3 SAE Transition", "WPA3 SAE", "WPA3 Enterprise"], null, true),
      field("576608", "Pre-Shared Key", "pre-shared-key", "Password"),
      field("576610", "Access Point(s)", "access-point-s", "Tag", undefined, "Configurations"),
      field("576611", "Wireless Controller(s)", "wireless-controller-s", "Tag", undefined, "Configurations"),
      field("576615", "Guest Network SSID", "guest-network-ssid", "Text"),
      field("576632", "Guest Network Pre-Shared Key", "guest-network-pre-shared-key", "Password"),
      field("582749", "Notes", "notes", "Textbox"),
    ],
  },
];

export const FLEXIBLE_ASSET_SCHEMAS = schemas;
export const FLEXIBLE_ASSET_TYPE_IDS = schemas.map((schema) => schema.typeId);
export const SENSITIVE_FLEXIBLE_ASSET_TYPE_ID = 393982;

const dynamicFieldCache = new Map<number, { expiresAt: number; fields: FlexibleAssetField[] }>();
const DYNAMIC_SCHEMA_CACHE_MS = 5 * 60 * 1000;

function textResult(value: unknown, isError = false): ToolResult {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }], ...(isError ? { isError: true } : {}) };
}

function errorResult(message: string): ToolResult {
  return textResult(`Error: ${message}`, true);
}

function numberId(value: unknown, label: string): number {
  const id = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(id) || Number(id) <= 0) throw new Error(`${label} must be a positive integer`);
  return Number(id);
}

function kebabToCamel(value: string): string {
  return value.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function getTrait(record: JsonRecord, fieldDef: FlexibleAssetField): unknown {
  const traits = record.traits;
  if (!traits || typeof traits !== "object" || Array.isArray(traits)) return undefined;
  const map = traits as JsonRecord;
  return map[fieldDef.nameKey] ?? map[kebabToCamel(fieldDef.nameKey)];
}

function isPasswordField(fieldDef: FlexibleAssetField): boolean {
  return fieldDef.kind === "Password";
}

function editableFields(schema: FlexibleAssetSchema): FlexibleAssetField[] {
  return schema.fields.filter((fieldDef) => fieldDef.kind !== "Header" && fieldDef.kind !== "Upload" && !isPasswordField(fieldDef));
}

function fieldDefForInput(schema: FlexibleAssetSchema, inputName: string): FlexibleAssetField | undefined {
  return schema.fields.find((fieldDef) => fieldInputName(fieldDef) === inputName || fieldDef.nameKey === inputName || kebabToCamel(fieldDef.nameKey) === inputName);
}

function fieldInputName(fieldDef: FlexibleAssetField): string {
  const aliases: Record<string, string> = {
    location: "location_ids",
    "location-s": "location_ids",
    "physical-location": "physical_location_ids",
  };
  if (aliases[fieldDef.nameKey]) return aliases[fieldDef.nameKey];
  return fieldDef.nameKey.replace(/-([a-z])/g, (_, letter: string) => `_${letter}`).replace(/[^a-zA-Z0-9_]/g, "_");
}

function schemaFieldByInput(schema: FlexibleAssetSchema): Map<string, FlexibleAssetField> {
  return new Map(editableFields(schema).map((fieldDef) => [fieldInputName(fieldDef), fieldDef]));
}

function normalizeRecord(record: JsonRecord, schema: FlexibleAssetSchema): JsonRecord {
  const fields: JsonRecord = {};
  for (const fieldDef of editableFields(schema)) {
    const value = getTrait(record, fieldDef);
    if (value !== undefined) fields[fieldInputName(fieldDef)] = fieldDef.kind === "Tag" ? tagIds(value).map(Number) : value;
  }
  return {
    id: record.id,
    type: record.type,
    name: record.name ?? fields[schema.titleInputNames[0]],
    organizationId: record.organizationId ?? record.organization_id,
    flexibleAssetTypeId: schema.typeId,
    fields,
  };
}

function redactRecord(record: JsonRecord, fields: readonly FlexibleAssetField[]): JsonRecord {
  const clone: JsonRecord = JSON.parse(JSON.stringify(record));
  const traits = clone.traits;
  if (traits && typeof traits === "object" && !Array.isArray(traits)) {
    for (const fieldDef of fields) {
      if (!isPasswordField(fieldDef)) continue;
      delete (traits as JsonRecord)[fieldDef.nameKey];
      delete (traits as JsonRecord)[kebabToCamel(fieldDef.nameKey)];
    }
  }
  return clone;
}

function parseFields(args: JsonRecord): JsonRecord {
  const fields = args.fields;
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) throw new Error("fields must be an object");
  return fields as JsonRecord;
}

function validateFieldValue(fieldDef: FlexibleAssetField, value: unknown, inputName: string): void {
  if (value === undefined || value === null) return;
  if (fieldDef.kind === "Select" && (!fieldDef.options || !fieldDef.options.includes(String(value)))) {
    throw new Error(`${inputName} must be one of: ${(fieldDef.options ?? []).join(", ")}`);
  }
  if (fieldDef.kind === "Checkbox" && typeof value !== "boolean") throw new Error(`${inputName} must be a boolean`);
  if (fieldDef.kind === "Number" && typeof value !== "number") throw new Error(`${inputName} must be a number`);
  if (fieldDef.kind === "Tag") {
    if (!Array.isArray(value) || value.some((item) => !Number.isSafeInteger(Number(item)) || Number(item) <= 0)) {
      throw new Error(`${inputName} must be an array of positive numeric IT Glue IDs`);
    }
  }
  if ((fieldDef.kind === "Text" || fieldDef.kind === "Textbox") && typeof value !== "string") throw new Error(`${inputName} must be text`);
}

function validateFields(schema: FlexibleAssetSchema, values: JsonRecord, requireAll: boolean): void {
  const byInput = schemaFieldByInput(schema);
  for (const [inputName, value] of Object.entries(values)) {
    const fieldDef = byInput.get(inputName);
    if (!fieldDef) throw new Error(`${inputName} is not an editable field for ${schema.name}`);
    validateFieldValue(fieldDef, value, inputName);
  }
  if (requireAll) {
    for (const required of schema.requiredInputNames) {
      if (values[required] === undefined || values[required] === null || (Array.isArray(values[required]) && values[required].length === 0)) {
        throw new Error(`${required} is required for ${schema.name}`);
      }
    }
  }
}

function traitsFromFields(schema: FlexibleAssetSchema, values: JsonRecord): JsonRecord {
  const byInput = schemaFieldByInput(schema);
  const traits: JsonRecord = {};
  for (const [inputName, value] of Object.entries(values)) {
    const fieldDef = byInput.get(inputName);
    if (!fieldDef) continue;
    traits[fieldDef.nameKey] = fieldDef.kind === "Tag" ? tagIds(value).map(Number) : value;
  }
  return traits;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    return left.map(String).sort().join(",") === right.map(String).sort().join(",");
  }
  return String(left ?? "").trim().toLowerCase() === String(right ?? "").trim().toLowerCase();
}

function tagIds(value: unknown): string[] {
  const values: unknown[] = Array.isArray(value)
    ? value
    : value && typeof value === "object" && !Array.isArray(value) && Array.isArray((value as JsonRecord).values)
      ? (value as JsonRecord).values as unknown[]
      : [value];
  return values
    .map((item) => item && typeof item === "object" ? (item as JsonRecord).id : item)
    .filter((item) => item !== undefined && item !== null)
    .map(String)
    .filter((item) => Number.isSafeInteger(Number(item)) && Number(item) > 0)
    .sort();
}

function identityMatches(schema: FlexibleAssetSchema, record: JsonRecord, values: JsonRecord): boolean {
  return schema.identityInputNames.every((inputName) => {
    const fieldDef = fieldDefForInput(schema, inputName);
    if (!fieldDef) return false;
    // A wireless asset without a physical location is unique by SSID within
    // the organization; only include the location in the identity when one
    // was supplied by the caller.
    if (fieldDef.kind === "Tag") {
      const requestedIds = tagIds(values[inputName]);
      if (requestedIds.length === 0) return true;
      return requestedIds.join(",") === tagIds(getTrait(record, fieldDef)).join(",");
    }
    return valuesEqual(getTrait(record, fieldDef), values[inputName]);
  });
}

async function fetchAssets(
  client: FlexibleAssetClient,
  schema: FlexibleAssetSchema,
  organizationId: number,
  pageSize = 100,
  pageNumber = 1,
  name?: string,
): Promise<JsonRecord[]> {
  const filter: JsonRecord = { flexibleAssetTypeId: schema.typeId, organizationId };
  if (name) filter.name = name;
  const result = await client.request<JsonRecord>("/flexible_assets", {
    filter,
    page: { size: pageSize, number: pageNumber },
  });
  return result.data;
}

async function fetchAsset(client: FlexibleAssetClient, schema: FlexibleAssetSchema, organizationId: number, id: number): Promise<JsonRecord> {
  const result = await client.request<JsonRecord>("/flexible_assets", {
    filter: { id, flexibleAssetTypeId: schema.typeId, organizationId },
    page: { size: 5, number: 1 },
  });
  const record = result.data[0];
  if (!record) throw new Error(`Flexible asset ${id} was not found in organization ${organizationId} for type ${schema.typeId}`);
  const recordOrganizationId = record.organizationId ?? record.organization_id;
  if (recordOrganizationId !== undefined && Number(recordOrganizationId) !== organizationId) {
    throw new Error(`Flexible asset ${id} does not belong to organization ${organizationId}`);
  }
  const recordTypeId = record.flexibleAssetTypeId ?? record.flexible_asset_type_id;
  if (recordTypeId !== undefined && Number(recordTypeId) !== schema.typeId) {
    throw new Error(`Flexible asset ${id} is not type ${schema.typeId}`);
  }
  return record;
}

function assetBody(schema: FlexibleAssetSchema, organizationId: number, values: JsonRecord, existingTraits?: JsonRecord): JsonRecord {
  const traits = { ...(existingTraits ?? {}), ...traitsFromFields(schema, values) };
  return {
    data: {
      type: "flexible-assets",
      attributes: {
        "organization-id": organizationId,
        "flexible-asset-type-id": schema.typeId,
        traits,
      },
    },
  };
}

function writableExistingTraits(schema: FlexibleAssetSchema, record: JsonRecord): JsonRecord {
  const traits: JsonRecord = {};
  for (const fieldDef of editableFields(schema)) {
    const value = getTrait(record, fieldDef);
    if (value === undefined) continue;
    traits[fieldDef.nameKey] = fieldDef.kind === "Tag" ? tagIds(value).map(Number) : value;
  }
  return traits;
}

async function loadDynamicFields(client: FlexibleAssetClient, typeId: number): Promise<FlexibleAssetField[]> {
  const cached = dynamicFieldCache.get(typeId);
  if (cached && cached.expiresAt > Date.now()) return cached.fields;
  const result = await client.request<JsonRecord>(`/flexible_asset_types/${typeId}/relationships/flexible_asset_fields`, { page: { size: 1000, number: 1 } });
  const fields = result.data.map((record) => {
    const attrs = (record.attributes ?? record) as JsonRecord;
    return {
      id: String(record.id),
      name: String(attrs.name ?? ""),
      nameKey: String(attrs.nameKey ?? attrs["name-key"] ?? ""),
      kind: String(attrs.kind ?? "Text") as FlexibleFieldKind,
      required: Boolean(attrs.required),
      useForTitle: Boolean(attrs.useForTitle ?? attrs["use-for-title"]),
      tagType: (attrs.tagType ?? attrs["tag-type"]) as string | null | undefined,
      options: typeof attrs.defaultValue === "string" && attrs.kind === "Select" ? attrs.defaultValue.split("\n").filter(Boolean) : undefined,
    };
  });
  dynamicFieldCache.set(typeId, { expiresAt: Date.now() + DYNAMIC_SCHEMA_CACHE_MS, fields });
  return fields;
}

async function liveSchema(client: FlexibleAssetClient, schema: FlexibleAssetSchema): Promise<FlexibleAssetSchema> {
  const liveFields = await loadDynamicFields(client, schema.typeId);
  const usableFields = liveFields.filter((fieldDef) => fieldDef.nameKey.length > 0);
  if (usableFields.length === 0) return schema;
  const byId = new Map(usableFields.map((fieldDef) => [fieldDef.id, fieldDef]));
  const byNameKey = new Map(usableFields.map((fieldDef) => [fieldDef.nameKey, fieldDef]));
  return {
    ...schema,
    fields: schema.fields.map((fieldDef) => byId.get(fieldDef.id) ?? byNameKey.get(fieldDef.nameKey) ?? fieldDef),
  };
}

export async function redactFlexibleAssetResult(client: FlexibleAssetClient, typeId: number, result: JsonRecord): Promise<JsonRecord> {
  const fields = await loadDynamicFields(client, typeId);
  return {
    ...result,
    data: Array.isArray(result.data) ? result.data.map((record) => redactRecord(record as JsonRecord, fields)) : result.data,
  };
}

export interface FlexibleAssetToolConfig {
  schema: FlexibleAssetSchema;
  searchName: string;
  getName: string;
  createName: string;
  updateName: string;
}

export const FLEXIBLE_ASSET_TOOL_CONFIGS: readonly FlexibleAssetToolConfig[] = [
  { schema: schemas[0], searchName: "search_printers", getName: "get_printer", createName: "create_printer", updateName: "update_printer" },
  { schema: schemas[1], searchName: "search_applications", getName: "get_application", createName: "create_application", updateName: "update_application" },
  { schema: schemas[2], searchName: "search_wan_links", getName: "get_wan_link", createName: "create_wan_link", updateName: "update_wan_link" },
  { schema: schemas[3], searchName: "search_lan_networks", getName: "get_lan_network", createName: "create_lan_network", updateName: "update_lan_network" },
  { schema: schemas[4], searchName: "search_wireless_networks", getName: "get_wireless_network", createName: "create_wireless_network", updateName: "update_wireless_network" },
];

const toolConfigByName = new Map<string, FlexibleAssetToolConfig>();
for (const config of FLEXIBLE_ASSET_TOOL_CONFIGS) {
  toolConfigByName.set(config.searchName, config);
  toolConfigByName.set(config.getName, config);
  toolConfigByName.set(config.createName, config);
  toolConfigByName.set(config.updateName, config);
}

function fieldInputSchema(fieldDef: FlexibleAssetField): JsonRecord {
  if (fieldDef.kind === "Select") return { type: "string", enum: fieldDef.options ?? [] };
  if (fieldDef.kind === "Checkbox") return { type: "boolean" };
  if (fieldDef.kind === "Number") return { type: "number" };
  if (fieldDef.kind === "Tag") return { type: "array", items: { type: "integer", minimum: 1 }, description: `IT Glue IDs for ${fieldDef.tagType ?? "related records"}` };
  return { type: "string" };
}

function fieldsInputSchema(schema: FlexibleAssetSchema, required: boolean): JsonRecord {
  const properties: JsonRecord = {};
  const requiredNames: string[] = [];
  for (const fieldDef of editableFields(schema)) {
    const inputName = fieldInputName(fieldDef);
    properties[inputName] = { ...fieldInputSchema(fieldDef), description: fieldDef.name };
    if (required && schema.requiredInputNames.includes(inputName)) requiredNames.push(inputName);
  }
  return { type: "object", properties, additionalProperties: false, ...(requiredNames.length > 0 ? { required: requiredNames } : {}) };
}

function baseProperties(): JsonRecord {
  return {
    organization_id: { type: "integer", minimum: 1, description: "IT Glue organization ID" },
  };
}

export function flexibleAssetToolDefinitions(): JsonRecord[] {
  const tools: JsonRecord[] = [];
  for (const config of FLEXIBLE_ASSET_TOOL_CONFIGS) {
    const { schema } = config;
    tools.push(
      { name: config.searchName, description: `Search ${schema.name} flexible assets in one IT Glue organization.`, inputSchema: { type: "object", properties: { ...baseProperties(), name: { type: "string" }, page_size: { type: "integer", minimum: 1, maximum: 1000 }, page_number: { type: "integer", minimum: 1 } }, required: ["organization_id"] } },
      { name: config.getName, description: `Read one ${schema.name} flexible asset. Password-kind fields are always omitted.`, inputSchema: { type: "object", properties: { ...baseProperties(), id: { type: "integer", minimum: 1 } }, required: ["organization_id", "id"] } },
      { name: config.createName, description: `Create a ${schema.name} flexible asset using the approved tenant schema. Duplicate identities are rejected.`, inputSchema: { type: "object", properties: { ...baseProperties(), fields: fieldsInputSchema(schema, true) }, required: ["organization_id", "fields"] } },
      { name: config.updateName, description: `Update an existing ${schema.name} flexible asset. Password-kind fields and uploads are unavailable.`, inputSchema: { type: "object", properties: { ...baseProperties(), id: { type: "integer", minimum: 1 }, fields: fieldsInputSchema(schema, false) }, required: ["organization_id", "id", "fields"] } },
    );
  }
  tools.push({
    name: "get_site_network_overview",
    description: "Return normalized WAN, LAN, and Wireless flexible-asset records for one IT Glue organization. Password fields are omitted.",
    inputSchema: { type: "object", properties: baseProperties(), required: ["organization_id"] },
  });
  return tools;
}

function configFor(name: string): FlexibleAssetToolConfig | undefined {
  return toolConfigByName.get(name);
}

export function isFlexibleAssetTool(name: string): boolean {
  return name === "get_site_network_overview" || toolConfigByName.has(name);
}

export function flexibleAssetToolTypeId(name: string): number | undefined {
  return configFor(name)?.schema.typeId;
}

export async function handleFlexibleAssetTool(name: string, args: JsonRecord, client: FlexibleAssetClient): Promise<ToolResult | undefined> {
  if (name === "get_site_network_overview") {
    try {
      const organizationId = numberId(args.organization_id, "organization_id");
      const results: JsonRecord = { organizationId };
      for (const config of FLEXIBLE_ASSET_TOOL_CONFIGS.slice(2)) {
        const schema = await liveSchema(client, config.schema);
        const records = await fetchAssets(client, schema, organizationId);
        results[schema.name] = records.map((record) => normalizeRecord(redactRecord(record, schema.fields), schema));
      }
      return textResult(results);
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : String(error));
    }
  }

  const config = configFor(name);
  if (!config) return undefined;
  try {
    const organizationId = numberId(args.organization_id, "organization_id");
    const schema = await liveSchema(client, config.schema);

    if (name === config.searchName) {
      const pageSize = typeof args.page_size === "number" ? Math.min(Math.max(Math.trunc(args.page_size), 1), 1000) : 100;
      const pageNumber = typeof args.page_number === "number" ? Math.max(Math.trunc(args.page_number), 1) : 1;
      const nameQuery = typeof args.name === "string" ? args.name.trim() : "";
      const records = await fetchAssets(client, schema, organizationId, pageSize, pageNumber, nameQuery || undefined);
      const nameFilter = typeof args.name === "string" ? args.name.trim().toLowerCase() : "";
      const filtered = nameFilter ? records.filter((record) => String(record.name ?? "").toLowerCase().includes(nameFilter)) : records;
      return textResult({ data: filtered.map((record) => normalizeRecord(redactRecord(record, schema.fields), schema)) });
    }

    if (name === config.getName) {
      const id = numberId(args.id, "id");
      const record = await fetchAsset(client, schema, organizationId, id);
      return textResult(normalizeRecord(redactRecord(record, schema.fields), schema));
    }

    const values = parseFields(args);
    validateFields(schema, values, name === config.createName);

    if (name === config.createName) {
      const records = await fetchAssets(client, schema, organizationId, 1000);
      const duplicate = records.find((record) => identityMatches(schema, record, values));
      if (duplicate) return errorResult(`A matching ${schema.name} already exists: ${duplicate.id}. Use the update tool instead.`);
      const created = await client.post<JsonRecord>("/flexible_assets", assetBody(schema, organizationId, values));
      return textResult(normalizeRecord(redactRecord(created, schema.fields), schema));
    }

    const id = numberId(args.id, "id");
    const existing = await fetchAsset(client, schema, organizationId, id);
    const mergedValues: JsonRecord = {};
    for (const fieldDef of editableFields(schema)) {
      const inputName = fieldInputName(fieldDef);
      const value = values[inputName] ?? getTrait(existing, fieldDef);
      if (value !== undefined) mergedValues[inputName] = value;
    }
    const updated = await client.patch<JsonRecord>(`/flexible_assets/${id}`, assetBody(schema, organizationId, mergedValues, writableExistingTraits(schema, existing)));
    return textResult(normalizeRecord(redactRecord(updated, schema.fields), schema));
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}
