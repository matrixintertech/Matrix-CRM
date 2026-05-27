export type SearchParamsInput = Record<string, string | string[] | undefined>;

export function getStringParam(searchParams: SearchParamsInput, key: string): string | undefined {
  const value = searchParams[key];

  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

export function getNumberParam(searchParams: SearchParamsInput, key: string): number | undefined {
  const value = getStringParam(searchParams, key);
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function resolveSearchParams(
  searchParams?: SearchParamsInput | Promise<SearchParamsInput>
): Promise<SearchParamsInput> {
  if (!searchParams) {
    return {};
  }

  return searchParams;
}
