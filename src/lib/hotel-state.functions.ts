import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { supabaseAdmin } from "@/integrations/supabase/client.server";

const stateKeySchema = z.enum(["bookings", "grid", "admins", "audit", "auth-history", "guest-passports", "guest-anketas","passports", "anketas"]);
const hasCloudEnv = () => Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

const getStateSchema = z.object({
  key: stateKeySchema,
});

const setStateSchema = z.object({
  key: stateKeySchema,
  stateData: z.any(),
});

export type HotelStateKey = z.infer<typeof stateKeySchema>;
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export const getHotelState = createServerFn({ method: "GET" })
  .inputValidator((input) => getStateSchema.parse(input))
  .handler(async ({ data }) => {
    if (!hasCloudEnv()) return null;
    const { data: row, error } = await (supabaseAdmin as any)
      .from("hotel_app_state")
      .select("state_data, version, updated_at")
      .eq("state_key", data.key)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!row) return null;

    return {
      stateData: row.state_data as JsonValue,
      version: Number(row.version ?? 0),
      updatedAt: String(row.updated_at ?? ""),
    };
  });

export const setHotelState = createServerFn({ method: "POST" })
  .inputValidator((input) => setStateSchema.parse(input))
  .handler(async ({ data }) => {
    if (!hasCloudEnv()) return { stateData: data.stateData as JsonValue, version: 0, updatedAt: "" };
    const { data: row, error } = await (supabaseAdmin as any)
      .from("hotel_app_state")
      .upsert(
        { state_key: data.key, state_data: data.stateData },
        { onConflict: "state_key" },
      )
      .select("state_data, version, updated_at")
      .single();

    if (error) throw new Error(error.message);

    return {
      stateData: row.state_data as JsonValue,
      version: Number(row.version ?? 0),
      updatedAt: String(row.updated_at ?? ""),
    };
  });