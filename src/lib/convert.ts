import { supabase } from "./supabase";

export type Format = "markdown" | "json";
export type Language = "en" | "it" | "fr";
export type Tier = "admin" | "pro" | "free";

export interface ConvertResponse {
  output: string;
  format: Format;
  tier: Tier;
  model: string;
  source?: string;
  finalUrl?: string;
}

export interface ConvertFileInput {
  file: File;
  format: Format;
  language: Language;
  fingerprint?: string;
  clientHash?: string;
}

/** Read a File as a base64 string (without the data-URL prefix). */
async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function convertFile(input: ConvertFileInput): Promise<ConvertResponse> {
  const base64 = await fileToBase64(input.file);
  const { data, error } = await supabase.functions.invoke<ConvertResponse>(
    "convert-file",
    {
      body: {
        filename: input.file.name,
        contentBase64: base64,
        format: input.format,
        language: input.language,
        fingerprint: input.fingerprint,
        clientHash: input.clientHash,
      },
    },
  );
  if (error) throw error;
  if (!data) throw new Error("empty_response");
  return data;
}

export interface FetchUrlInput {
  url: string;
  format: Format;
  language: Language;
  fingerprint?: string;
  clientHash?: string;
}

export async function fetchUrl(input: FetchUrlInput): Promise<ConvertResponse> {
  const { data, error } = await supabase.functions.invoke<ConvertResponse>(
    "fetch-url",
    { body: input },
  );
  if (error) throw error;
  if (!data) throw new Error("empty_response");
  return data;
}
